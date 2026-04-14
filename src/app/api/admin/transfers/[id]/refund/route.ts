import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { transitionTransfer } from '@/lib/transfers/state-machine'
import { TransferStatus, ActorType } from '@/generated/prisma/enums'
import { logAuthEvent } from '@/lib/auth/audit'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)
    const { id: transferId } = await params

    const transfer = await transitionTransfer({
      transferId,
      toStatus: TransferStatus.REFUNDED,
      actor: ActorType.ADMIN,
      actorId: userId,
      expectedStatus: TransferStatus.NEEDS_MANUAL,
      metadata: { action: 'admin_refund', adminId: userId },
    })

    await logAuthEvent({
      userId,
      event: 'ADMIN_TRANSFER_REFUND',
      metadata: { transferId, fromStatus: 'NEEDS_MANUAL' },
    })

    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Refund failed'
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
