import { prisma } from '../../db/client'
import { transitionTransfer } from '../../transfers/state-machine'
import { TransferStatus, ActorType, PayoutProvider as PayoutProviderEnum } from '../../../generated/prisma/enums'
import type { Transfer } from '../../../generated/prisma/client'
import type { PayoutProvider } from './types'
import { generatePayoutReference } from './types'
import { FlutterwaveProvider } from './flutterwave'
import { BudPayProvider } from './budpay'

const MAX_RETRIES = 3

export class PayoutOrchestrator {
  private readonly primary: PayoutProvider
  private readonly fallback: PayoutProvider

  constructor(primary: PayoutProvider, fallback: PayoutProvider) {
    this.primary = primary
    this.fallback = fallback
  }

  private getProviderByName(name: PayoutProviderEnum | null): PayoutProvider {
    return name === PayoutProviderEnum.FLUTTERWAVE ? this.fallback : this.primary
  }

  private async startPayoutAttempt(
    transfer: Transfer & {
      recipient: {
        bankCode: string
        accountNumber: string
        fullName: string
      }
    },
    provider: PayoutProvider,
    expectedStatus: TransferStatus,
    actor: ActorType,
    actorId?: string,
    metadata: Record<string, unknown> = {},
    transferPatch: Partial<{
      retryCount: number
    }> = {},
  ): Promise<Transfer> {
    const reference = generatePayoutReference(transfer.id)
    const result = await provider.initiatePayout({
      transferId: transfer.id,
      amount: transfer.receiveAmount,
      currency: transfer.receiveCurrency,
      bankCode: transfer.recipient.bankCode,
      accountNumber: transfer.recipient.accountNumber,
      recipientName: transfer.recipient.fullName,
      reference,
    })

    await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        payoutProvider: provider.name as PayoutProviderEnum,
        payoutProviderRef: result.providerRef,
        ...transferPatch,
      },
    })

    return transitionTransfer({
      transferId: transfer.id,
      toStatus: TransferStatus.PROCESSING_NGN,
      actor,
      actorId,
      expectedStatus,
      metadata: { ...metadata, provider: provider.name, providerRef: result.providerRef, reference },
    })
  }

  async initiatePayout(transferId: string): Promise<Transfer> {
    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { recipient: true },
    })

    if (transfer.status !== TransferStatus.AUD_RECEIVED) {
      throw new Error(`Cannot initiate payout: transfer ${transferId} is in state ${transfer.status}, expected AUD_RECEIVED`)
    }

    return this.startPayoutAttempt(
      transfer,
      this.primary,
      TransferStatus.AUD_RECEIVED,
      ActorType.SYSTEM,
    )
  }

  async handlePayoutSuccess(transferId: string): Promise<Transfer> {
    // PROCESSING_NGN -> NGN_SENT
    await transitionTransfer({
      transferId,
      toStatus: TransferStatus.NGN_SENT,
      actor: ActorType.SYSTEM,
      expectedStatus: TransferStatus.PROCESSING_NGN,
    })

    // NGN_SENT -> COMPLETED
    return transitionTransfer({
      transferId,
      toStatus: TransferStatus.COMPLETED,
      actor: ActorType.SYSTEM,
      expectedStatus: TransferStatus.NGN_SENT,
    })
  }

  async handlePayoutFailure(transferId: string, reason: string): Promise<Transfer> {
    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { recipient: true },
    })

    // PROCESSING_NGN -> NGN_FAILED
    await transitionTransfer({
      transferId,
      toStatus: TransferStatus.NGN_FAILED,
      actor: ActorType.SYSTEM,
      expectedStatus: TransferStatus.PROCESSING_NGN,
      metadata: { reason },
    })

    const currentRetryCount = transfer.retryCount
    const currentProvider = transfer.payoutProvider

    // If retryCount < MAX_RETRIES - 1: re-initiate payout with the same
    // provider. A pure NGN_RETRY -> PROCESSING_NGN status flip is not a retry;
    // it just lies about work being in flight.
    if (currentRetryCount < MAX_RETRIES - 1) {
      await transitionTransfer({
        transferId,
        toStatus: TransferStatus.NGN_RETRY,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_FAILED,
        metadata: { retryProvider: currentProvider },
      })

      const retryTransfer = await prisma.transfer.findUniqueOrThrow({
        where: { id: transferId },
        include: { recipient: true },
      })

      return this.startPayoutAttempt(
        retryTransfer,
        this.getProviderByName(currentProvider),
        TransferStatus.NGN_RETRY,
        ActorType.SYSTEM,
        undefined,
        {
          retryProvider: currentProvider,
          retryAttempt: currentRetryCount + 1,
        },
      )
    }

    // retryCount >= MAX_RETRIES - 1 (this retry will make it = MAX_RETRIES).
    // Primary is BudPay; Flutterwave is the fallback.
    if (currentProvider === 'BUDPAY') {
      // Failover: BudPay → Flutterwave
      // NGN_FAILED -> NGN_RETRY
      await transitionTransfer({
        transferId,
        toStatus: TransferStatus.NGN_RETRY,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_FAILED,
        metadata: { failover: true, fromProvider: 'BUDPAY', toProvider: 'FLUTTERWAVE' },
      })

      const retryTransfer = await prisma.transfer.findUniqueOrThrow({
        where: { id: transferId },
        include: { recipient: true },
      })

      return this.startPayoutAttempt(
        retryTransfer,
        this.fallback,
        TransferStatus.NGN_RETRY,
        ActorType.SYSTEM,
        undefined,
        {
          failover: true,
          fromProvider: 'BUDPAY',
          toProvider: 'FLUTTERWAVE',
        },
        { retryCount: -1 },
      )
    }

    // Flutterwave (fallback) also exhausted: NEEDS_MANUAL
    // NGN_FAILED -> NEEDS_MANUAL
    return transitionTransfer({
      transferId,
      toStatus: TransferStatus.NEEDS_MANUAL,
      actor: ActorType.SYSTEM,
      expectedStatus: TransferStatus.NGN_FAILED,
      metadata: { reason, exhaustedProviders: ['BUDPAY', 'FLUTTERWAVE'] },
    })
  }

  async handleManualRetry(transferId: string, adminId: string): Promise<Transfer> {
    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { recipient: true },
    })

    if (transfer.status !== TransferStatus.NEEDS_MANUAL) {
      throw new Error(`Cannot manual retry: transfer ${transferId} is in state ${transfer.status}, expected NEEDS_MANUAL`)
    }

    return this.startPayoutAttempt(
      transfer,
      this.primary,
      TransferStatus.NEEDS_MANUAL,
      ActorType.ADMIN,
      adminId,
      { manualRetry: true },
      { retryCount: 0 },
    )
  }

  async resumeRetry(transferId: string): Promise<Transfer> {
    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { recipient: true },
    })

    if (transfer.status !== TransferStatus.NGN_RETRY) {
      throw new Error(
        `Cannot resume retry: transfer ${transferId} is in state ${transfer.status}, expected NGN_RETRY`,
      )
    }

    return this.startPayoutAttempt(
      transfer,
      this.getProviderByName(transfer.payoutProvider),
      TransferStatus.NGN_RETRY,
      ActorType.SYSTEM,
      undefined,
      { reason: 'reconciliation_retry_resume' },
    )
  }
}

export function getOrchestrator(): PayoutOrchestrator {
  // Primary: BudPay (CBN-licensed NGN disburser). Fallback: Flutterwave.
  const primary = new BudPayProvider({
    secretKey: process.env.BUDPAY_SECRET_KEY ?? '',
    apiUrl: process.env.BUDPAY_API_URL ?? 'https://api.budpay.com',
  })
  const fallback = new FlutterwaveProvider({
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? '',
    apiUrl: process.env.FLUTTERWAVE_API_URL ?? 'https://api.flutterwave.com/v3',
  })
  return new PayoutOrchestrator(primary, fallback)
}
