import Decimal from 'decimal.js'
import { prisma } from '../../db/client.js'
import { transitionTransfer } from '../../transfers/state-machine.js'
import { TransferNotFoundError } from '../../transfers/errors.js'
import type { MonoovaClient } from './client.js'
import type { Transfer } from '../../../generated/prisma/client.js'

const AMOUNT_TOLERANCE = new Decimal('0.01')

export async function generatePayIdForTransfer(
  transferId: string,
  client: MonoovaClient
): Promise<Transfer> {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({ where: { id: transferId } })
    if (!transfer) throw new TransferNotFoundError(transferId)

    if (transfer.status !== 'CREATED') {
      throw new Error(`Transfer ${transferId} is not in CREATED state`)
    }

    // Generate PayID reference: KL-{transferId}-{timestamp}
    const reference = `KL-${transferId}-${Date.now()}`

    // Call Monoova to create PayID
    const result = await client.createPayId({
      transferId,
      amount: new Decimal(transfer.sendAmount.toString()),
      reference,
    })

    // Store PayID refs on the transfer
    await tx.transfer.update({
      where: { id: transferId },
      data: {
        payidReference: result.payIdReference,
        payidProviderRef: result.payId,
      },
    })

    // Transition to AWAITING_AUD via state machine
    return transitionTransfer({
      transferId,
      toStatus: 'AWAITING_AUD',
      actor: 'SYSTEM',
      metadata: {
        payidReference: result.payIdReference,
        payidProviderRef: result.payId,
      },
    })
  })
}

export async function handlePaymentReceived(
  transferId: string,
  receivedAmount: Decimal
): Promise<Transfer> {
  // Load transfer to validate amount
  const transfer = await prisma.transfer.findUnique({ where: { id: transferId } })
  if (!transfer) throw new TransferNotFoundError(transferId)

  const expectedAmount = new Decimal(transfer.sendAmount.toString())
  const difference = receivedAmount.minus(expectedAmount).abs()

  if (difference.gt(AMOUNT_TOLERANCE)) {
    throw new Error(
      `Amount mismatch: expected ${expectedAmount.toFixed(2)}, received ${receivedAmount.toFixed(2)}`
    )
  }

  // Transition to AUD_RECEIVED
  return transitionTransfer({
    transferId,
    toStatus: 'AUD_RECEIVED',
    actor: 'SYSTEM',
    expectedStatus: 'AWAITING_AUD',
    metadata: {
      receivedAmount: receivedAmount.toFixed(2),
      expectedAmount: expectedAmount.toFixed(2),
    },
  })
}
