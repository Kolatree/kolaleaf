import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { jsonError } from '@/lib/http/json-error'
import { transitionTransfer } from '@/lib/transfers/state-machine'
import { TransferStatus, ActorType } from '@/generated/prisma/enums'
import { logAuthEvent } from '@/lib/auth/audit'
import { AdminRefundRequest } from './_schemas'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)
    const { id: transferId } = await params
    const body = AdminRefundRequest.parse(await request.json())

    const transfer = await transitionTransfer({
      transferId,
      toStatus: TransferStatus.REFUNDED,
      actor: ActorType.ADMIN,
      actorId: userId,
      expectedStatus: TransferStatus.NEEDS_MANUAL,
      metadata: {
        action: 'manual_refund_marked',
        adminId: userId,
        refundReference: body.refundReference,
        note: body.note,
      },
    })

    await logAuthEvent({
      userId,
      event: 'ADMIN_TRANSFER_REFUND',
      metadata: {
        transferId,
        fromStatus: 'NEEDS_MANUAL',
        action: 'manual_refund_marked',
        refundReference: body.refundReference,
      },
    })

    return NextResponse.json({ transfer })
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError(error.message, error.message, error.statusCode)
    }
    if (error instanceof ZodError) {
      return jsonError('invalid_refund_request', 'Invalid refund request', 400)
    }
    const message = error instanceof Error ? error.message : 'Refund failed'
    const name = error instanceof Error ? error.name : ''
    if (name === 'InvalidTransitionError' || name === 'ConcurrentModificationError') {
      return jsonError('conflict', message, 409)
    }
    if (name === 'TransferNotFoundError') {
      return jsonError('transfer_not_found', message, 404)
    }
    return jsonError('refund_failed', message, 500)
  }
}
