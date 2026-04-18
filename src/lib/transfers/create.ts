import Decimal from 'decimal.js'
import { prisma } from '../db/client'
import {
  KycNotVerifiedError,
  InvalidCorridorError,
  AmountOutOfRangeError,
  DailyLimitExceededError,
  RecipientNotOwnedError,
} from './errors'
import type { Transfer } from '../../generated/prisma/client'
import { recordVelocityCheck } from '../compliance/velocity'
import { recordAustracReports } from '../compliance/austrac-reports'

interface CreateTransferParams {
  userId: string
  recipientId: string
  corridorId: string
  sendAmount: Decimal
  exchangeRate: Decimal
  fee: Decimal
}

export async function createTransfer(params: CreateTransferParams): Promise<Transfer> {
  const { userId, recipientId, corridorId, sendAmount, exchangeRate, fee } = params

  return prisma.$transaction(async (tx) => {
    // 1. Validate user exists and KYC is VERIFIED
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.kycStatus !== 'VERIFIED') {
      throw new KycNotVerifiedError(userId)
    }

    // 2. Validate recipient exists and belongs to user
    const recipient = await tx.recipient.findUnique({ where: { id: recipientId } })
    if (!recipient || recipient.userId !== userId) {
      throw new RecipientNotOwnedError(recipientId, userId)
    }

    // 3. Validate corridor exists and is active
    const corridor = await tx.corridor.findUnique({ where: { id: corridorId } })
    if (!corridor) {
      throw new InvalidCorridorError(`Corridor ${corridorId} not found`)
    }
    if (!corridor.active) {
      throw new InvalidCorridorError(`Corridor ${corridorId} is not active`)
    }

    // 4. Validate sendAmount is within corridor min/max
    const min = new Decimal(corridor.minAmount.toString())
    const max = new Decimal(corridor.maxAmount.toString())
    if (sendAmount.lt(min)) {
      throw new AmountOutOfRangeError(
        `Send amount ${sendAmount} is below minimum ${min} for corridor`
      )
    }
    if (sendAmount.gt(max)) {
      throw new AmountOutOfRangeError(
        `Send amount ${sendAmount} is above maximum ${max} for corridor`
      )
    }

    // 5. Validate daily limit
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setUTCHours(23, 59, 59, 999)

    const todaysTransfers = await tx.transfer.findMany({
      where: {
        userId,
        createdAt: { gte: todayStart, lte: todayEnd },
        status: { notIn: ['CANCELLED', 'EXPIRED', 'REFUNDED'] },
      },
      select: { sendAmount: true },
    })

    const todayTotal = todaysTransfers.reduce(
      (sum, t) => sum.plus(new Decimal(t.sendAmount.toString())),
      new Decimal(0)
    )
    const dailyLimit = new Decimal(user.dailyLimit.toString())
    const projectedTotal = todayTotal.plus(sendAmount)

    if (projectedTotal.gt(dailyLimit)) {
      throw new DailyLimitExceededError(userId, dailyLimit.toString(), projectedTotal.toString())
    }

    // 6. Calculate receiveAmount
    const receiveAmount = sendAmount.mul(exchangeRate)

    // 7. Create the transfer
    const transfer = await tx.transfer.create({
      data: {
        userId,
        recipientId,
        corridorId,
        sendAmount: sendAmount.toString(),
        receiveAmount: receiveAmount.toString(),
        exchangeRate: exchangeRate.toString(),
        fee: fee.toString(),
        status: 'CREATED',
      },
    })

    // 8. Create initial TransferEvent (NULL_STATE -> CREATED). Using
    //    the NULL_STATE sentinel instead of a CREATED -> CREATED self-
    //    transition so AUSTRAC reconciliation tooling sees a monotone
    //    state progression (Step 31 / audit gap #5).
    await tx.transferEvent.create({
      data: {
        transferId: transfer.id,
        fromStatus: 'NULL_STATE',
        toStatus: 'CREATED',
        actor: 'USER',
      },
    })

    return { transfer, corridor }
  }).then(async ({ transfer, corridor }) => {
    // 9. Compliance side-effects run AFTER the transaction commits so
    //    a compliance-pipe failure can't roll back a legitimate
    //    transfer. Each helper swallows its own errors + logs —
    //    belt-and-braces so a customer's transfer succeeds even if
    //    ComplianceReport writes are broken.
    void recordVelocityCheck(userId, transfer.id)
    // AUSTRAC TTR (AUD >= 9,500 buffered) + IFTI (every transfer —
    // all Kolaleaf corridors are cross-border by construction).
    void recordAustracReports({
      userId,
      transferId: transfer.id,
      sendAmountAud: sendAmount,
      baseCurrency: corridor.baseCurrency,
      targetCurrency: corridor.targetCurrency,
    })
    return transfer
  })
}
