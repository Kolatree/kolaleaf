import { TransferStatus, ActorType } from '../../generated/prisma/enums'
import { prisma } from '../db/client'
import { isValidTransition } from './transitions'
import {
  InvalidTransitionError,
  ConcurrentModificationError,
  TransferNotFoundError,
} from './errors'
import type { Transfer } from '../../generated/prisma/client'

interface TransitionParams {
  transferId: string
  toStatus: TransferStatus
  actor: ActorType
  actorId?: string
  metadata?: Record<string, unknown>
  expectedStatus?: TransferStatus
}

export async function transitionTransfer(params: TransitionParams): Promise<Transfer> {
  const { transferId, toStatus, actor, actorId, metadata, expectedStatus } = params

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({ where: { id: transferId } })
    if (!transfer) throw new TransferNotFoundError(transferId)

    const fromStatus = transfer.status as TransferStatus

    // Optimistic locking: if caller declares what status they expect, verify it
    if (expectedStatus && fromStatus !== expectedStatus) {
      throw new ConcurrentModificationError(transferId)
    }

    // Business rule: NGN_RETRY with retryCount >= 3 forces NEEDS_MANUAL
    let effectiveToStatus = toStatus
    if (fromStatus === 'NGN_RETRY' && toStatus === 'PROCESSING_NGN' && transfer.retryCount >= 3) {
      effectiveToStatus = 'NEEDS_MANUAL'
    }

    if (!isValidTransition(fromStatus, effectiveToStatus)) {
      throw new InvalidTransitionError(fromStatus, effectiveToStatus)
    }

    // Build update data
    const updateData: Record<string, unknown> = { status: effectiveToStatus }

    // Increment retryCount when retrying from NGN_RETRY
    if (fromStatus === 'NGN_RETRY' && effectiveToStatus === 'PROCESSING_NGN') {
      updateData.retryCount = transfer.retryCount + 1
    }

    // Set completedAt when reaching COMPLETED
    if (effectiveToStatus === 'COMPLETED') {
      updateData.completedAt = new Date()
    }

    // Optimistic lock: only update if status hasn't changed since we read it
    const updated = await tx.transfer.updateMany({
      where: { id: transferId, status: fromStatus },
      data: updateData,
    })

    if (updated.count === 0) {
      throw new ConcurrentModificationError(transferId)
    }

    // Create audit event
    await tx.transferEvent.create({
      data: {
        transferId,
        fromStatus,
        toStatus: effectiveToStatus,
        actor,
        actorId,
        metadata: (metadata as object) ?? undefined,
      },
    })

    // Return the updated transfer
    return tx.transfer.findUniqueOrThrow({ where: { id: transferId } })
  })
}
