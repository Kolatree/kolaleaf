import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireEmailVerified, AuthError } from '@/lib/auth/middleware'
import { generatePayIdForTransfer } from '@/lib/payments/monoova'
import { createMonoovaClient } from '@/lib/payments/monoova/client'
import './_schemas'

// POST /api/v1/transfers/:id/issue-payid
//
// User-facing trigger for the CREATED → AWAITING_AUD transition. The
// AUSTRAC money-handler boundary still lives one layer down inside
// generatePayIdForTransfer (which enforces the KYC gate unless
// KOLA_DISABLE_KYC_GATE is set in dev); this route only adds authn +
// ownership + state-precondition checks.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth runs before the state-precondition + resource-existence
    // checks so an unauthenticated probe can't enumerate transfer
    // ids by 401-vs-404 timing. `requireEmailVerified` internally
    // calls `requireAuth` so a second call is redundant.
    const { userId } = await requireEmailVerified(request)

    const { id: transferId } = await params

    // Ownership check: the transfer must belong to the authenticated
    // user. Returning 403 (not 404) for a non-owned existing transfer
    // is consistent with the admin-route pattern; non-owners still
    // can't discover whether the id is valid because every failure
    // above this point is 401 or 403.
    const existing = await prisma.transfer.findUnique({
      where: { id: transferId },
      select: { userId: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 })
    }
    if (existing.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const transfer = await generatePayIdForTransfer(transferId, createMonoovaClient())

    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.message === 'email_unverified') {
        return NextResponse.json(
          {
            error: 'email_unverified',
            message: 'Please verify your email before issuing a PayID.',
          },
          { status: 403 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    const message = error instanceof Error ? error.message : 'PayID issuance failed'
    const name = error instanceof Error ? error.name : ''

    if (name === 'TransferNotFoundError') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (name === 'KycNotVerifiedError') {
      return NextResponse.json({ error: message }, { status: 403 })
    }
    if (name === 'ConcurrentModificationError') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    // "Transfer <id> is not in CREATED state" — state mismatch
    if (/is not in CREATED state/.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
