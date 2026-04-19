import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { logAuthEvent } from '@/lib/auth/audit'
import { getOrchestrator } from '@/lib/payments/payout/orchestrator'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)
    const { id: transferId } = await params

    const transfer = await getOrchestrator().handleManualRetry(transferId, userId)

    await logAuthEvent({
      userId,
      event: 'ADMIN_TRANSFER_RETRY',
      metadata: {
        transferId,
        fromStatus: 'NEEDS_MANUAL',
        action: 'manual_retry',
        payoutProvider: transfer.payoutProvider,
        payoutProviderRef: transfer.payoutProviderRef,
      },
    })

    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Retry failed'
    const name = error instanceof Error ? error.name : ''
    if (name === 'InvalidTransitionError' || name === 'ConcurrentModificationError') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (name === 'TransferNotFoundError') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
