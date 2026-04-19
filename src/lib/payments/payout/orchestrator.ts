import { prisma } from '../../db/client'
import { transitionTransfer } from '../../transfers/state-machine'
import { TransferStatus, ActorType, PayoutProvider as PayoutProviderEnum } from '../../../generated/prisma/enums'
import type { Transfer } from '../../../generated/prisma/client'
import type { PayoutProvider } from './types'
import { generatePayoutReference } from './types'
import { FlutterwaveProvider } from './flutterwave'
import { BudPayProvider } from './budpay'

const MAX_RETRIES = 3
// Sentinel for the failover retryCount reset. The state machine's
// NGN_RETRY → PROCESSING_NGN transition increments retryCount, so
// starting at -1 yields 0 after the transition — i.e., attempt 0 on
// the new provider. Named to make the arithmetic intent explicit.
const FAILOVER_RETRY_COUNT_SENTINEL = -1

// Named predicate for the same-provider retry window. `currentCount`
// is the retryCount read BEFORE the current failure is processed;
// returns true if another attempt on the same provider is still
// within the `MAX_RETRIES` budget (attempts 0 and 1 re-try; attempt 2
// triggers failover).
function hasSameProviderRetriesRemaining(currentCount: number): boolean {
  return currentCount < MAX_RETRIES - 1
}

export class PayoutOrchestrator {
  private readonly primary: PayoutProvider
  private readonly fallback: PayoutProvider
  private readonly providersByName: Map<PayoutProviderEnum, PayoutProvider>

  constructor(primary: PayoutProvider, fallback: PayoutProvider) {
    this.primary = primary
    this.fallback = fallback
    // Explicit provider map so lookup doesn't implicitly assume
    // "FLUTTERWAVE === fallback". If the primary/fallback pair ever
    // swaps (or a third provider is added), this grows without
    // touching the retry logic.
    this.providersByName = new Map<PayoutProviderEnum, PayoutProvider>([
      [primary.name as PayoutProviderEnum, primary],
      [fallback.name as PayoutProviderEnum, fallback],
    ])
  }

  private getProviderByName(name: PayoutProviderEnum | null): PayoutProvider {
    // Fallback to primary when name is null (never-attempted transfer)
    // or when a historical enum value no longer maps to a provider.
    if (name === null) return this.primary
    return this.providersByName.get(name) ?? this.primary
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

    // Same-provider retry window. A pure NGN_RETRY -> PROCESSING_NGN
    // status flip is not a retry; it just lies about work being in
    // flight, so we actually re-call the provider's initiatePayout.
    if (hasSameProviderRetriesRemaining(currentRetryCount)) {
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
    // Primary (BudPay) exhausted → failover to fallback (Flutterwave).
    if (currentProvider === PayoutProviderEnum.BUDPAY) {
      // Failover: BudPay → Flutterwave
      // NGN_FAILED -> NGN_RETRY
      await transitionTransfer({
        transferId,
        toStatus: TransferStatus.NGN_RETRY,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_FAILED,
        metadata: {
          failover: true,
          fromProvider: PayoutProviderEnum.BUDPAY,
          toProvider: PayoutProviderEnum.FLUTTERWAVE,
        },
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
          fromProvider: PayoutProviderEnum.BUDPAY,
          toProvider: PayoutProviderEnum.FLUTTERWAVE,
        },
        { retryCount: FAILOVER_RETRY_COUNT_SENTINEL },
      )
    }

    // Flutterwave (fallback) also exhausted: NEEDS_MANUAL
    // NGN_FAILED -> NEEDS_MANUAL
    return transitionTransfer({
      transferId,
      toStatus: TransferStatus.NEEDS_MANUAL,
      actor: ActorType.SYSTEM,
      expectedStatus: TransferStatus.NGN_FAILED,
      metadata: {
        reason,
        exhaustedProviders: [PayoutProviderEnum.BUDPAY, PayoutProviderEnum.FLUTTERWAVE],
      },
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
