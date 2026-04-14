import { prisma } from '../db/client.js'
import { isValidTransition } from './transitions.js'
import {
  InvalidTransitionError,
  ConcurrentModificationError,
  TransferNotFoundError,
  NotTransferOwnerError,
} from './errors.js'
import type { Transfer } from '../../generated/prisma/client.js'
import type { TransferStatus } from '../../generated/prisma/enums.js'

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
