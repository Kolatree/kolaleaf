import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { withAdmin } from '@/lib/auth/admin-middleware'
import { jsonError } from '@/lib/http/json-error'
import { transitionTransfer } from '@/lib/transfers/state-machine'
import { TransferStatus, ActorType } from '@/generated/prisma/enums'
import { logAuthEvent } from '@/lib/auth/audit'
import { AdminRefundRequest } from './_schemas'

export const POST = withAdmin(async (request, userId) => {
  const url = new URL(request.url)
  const transferId = url.pathname.split('/').at(-2)!

  let body: { refundReference: string; note?: string }
  try {
    body = AdminRefundRequest.parse(await request.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError('invalid_refund_request', 'Invalid refund request', 400)
    }
    throw error
  }

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
})
