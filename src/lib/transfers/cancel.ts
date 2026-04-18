import { prisma } from '../db/client'
import { isValidTransition } from './transitions'
import {
  InvalidTransitionError,
  ConcurrentModificationError,
  TransferNotFoundError,
  NotTransferOwnerError,
  CancelTooLateError,
} from './errors'
import type { Transfer } from '../../generated/prisma/client'
import type { TransferStatus } from '../../generated/prisma/enums'

// Past these states the AUD has already been received from the
// customer and we owe them value back via refund — cancellation is
// no longer the correct remedy. Keeping this set here (rather than
// inferring from VALID_TRANSITIONS) makes the cancel-window
// boundary explicit.
const NON_CANCELLABLE_AFTER: ReadonlySet<TransferStatus> = new Set<TransferStatus>([
  'AUD_RECEIVED',
  'PROCESSING_NGN',
  'FLOAT_INSUFFICIENT',
  'NGN_SENT',
  'NGN_FAILED',
  'NGN_RETRY',
  'NEEDS_MANUAL',
  'COMPLETED',
  'REFUNDED',
])

interface CancelParams {
  transferId: string
  userId: string
}

export async function cancelTransfer(params: CancelParams): Promise<Transfer> {
  const { transferId, userId } = params

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({ where: { id: transferId } })
    if (!transfer) throw new TransferNotFoundError(transferId)

    if (transfer.userId !== userId) {
      throw new NotTransferOwnerError(transferId, userId)
    }

    const fromStatus = transfer.status as TransferStatus
    if (!isValidTransition(fromStatus, 'CANCELLED')) {
      // Step 31 / audit gap #19: give a user-friendly error when
      // cancel is attempted too late (post-AUD). Terminal states
      // (CANCELLED, EXPIRED) and the pre-AUD legal path fall
      // through to the generic invalid-transition error.
      if (NON_CANCELLABLE_AFTER.has(fromStatus)) {
        throw new CancelTooLateError(transferId, fromStatus)
      }
      throw new InvalidTransitionError(fromStatus, 'CANCELLED')
    }

    // Optimistic lock: update only if status hasn't changed
    const updated = await tx.transfer.updateMany({
      where: { id: transferId, status: fromStatus },
      data: { status: 'CANCELLED' },
    })

    if (updated.count === 0) {
      throw new ConcurrentModificationError(transferId)
    }

    await tx.transferEvent.create({
      data: {
        transferId,
        fromStatus,
        toStatus: 'CANCELLED',
        actor: 'USER',
        actorId: userId,
      },
    })

    return tx.transfer.findUniqueOrThrow({ where: { id: transferId } })
  })
}
