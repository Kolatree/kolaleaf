import { prisma } from '../../db/client.js'
import { transitionTransfer } from '../../transfers/state-machine.js'
import { TransferStatus, ActorType, PayoutProvider as PayoutProviderEnum } from '../../../generated/prisma/enums.js'
import type { Transfer } from '../../../generated/prisma/client.js'
import type { PayoutProvider } from './types.js'
import { generatePayoutReference } from './types.js'
import { FlutterwaveProvider } from './flutterwave.js'
import { PaystackProvider } from './paystack.js'

const MAX_RETRIES = 3

export class PayoutOrchestrator {
  private readonly primary: PayoutProvider
  private readonly fallback: PayoutProvider

  constructor(primary: PayoutProvider, fallback: PayoutProvider) {
    this.primary = primary
    this.fallback = fallback
  }

  async initiatePayout(transferId: string): Promise<Transfer> {
    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { recipient: true },
    })

    if (transfer.status !== TransferStatus.AUD_RECEIVED) {
      throw new Error(`Cannot initiate payout: transfer ${transferId} is in state ${transfer.status}, expected AUD_RECEIVED`)
    }

    const provider = this.primary
    const reference = generatePayoutReference(transferId)

    const result = await provider.initiatePayout({
      transferId,
      amount: transfer.receiveAmount,
      currency: transfer.receiveCurrency,
      bankCode: transfer.recipient.bankCode,
      accountNumber: transfer.recipient.accountNumber,
      recipientName: transfer.recipient.fullName,
      reference,
    })

    // Set provider info on the transfer
    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        payoutProvider: provider.name as PayoutProviderEnum,
        payoutProviderRef: result.providerRef,
      },
    })

    // Transition AUD_RECEIVED -> PROCESSING_NGN
    return transitionTransfer({
      transferId,
      toStatus: TransferStatus.PROCESSING_NGN,
      actor: ActorType.SYSTEM,
      expectedStatus: TransferStatus.AUD_RECEIVED,
      metadata: { provider: provider.name, providerRef: result.providerRef, reference },
    })
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

    // If retryCount < MAX_RETRIES - 1: retry with same provider
    // (We check < MAX_RETRIES - 1 because the transition from NGN_RETRY -> PROCESSING_NGN will increment retryCount)
    if (currentRetryCount < MAX_RETRIES - 1) {
      // NGN_FAILED -> NGN_RETRY
      await transitionTransfer({
        transferId,
        toStatus: TransferStatus.NGN_RETRY,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_FAILED,
      })

      // NGN_RETRY -> PROCESSING_NGN (state machine increments retryCount)
      return transitionTransfer({
        transferId,
        toStatus: TransferStatus.PROCESSING_NGN,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_RETRY,
      })
    }

    // retryCount >= MAX_RETRIES - 1 (this retry will make it = MAX_RETRIES)
    if (currentProvider === 'FLUTTERWAVE') {
      // Failover: switch to Paystack
      // NGN_FAILED -> NGN_RETRY
      await transitionTransfer({
        transferId,
        toStatus: TransferStatus.NGN_RETRY,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_FAILED,
        metadata: { failover: true, fromProvider: 'FLUTTERWAVE', toProvider: 'PAYSTACK' },
      })

      // Initiate payout with fallback provider
      const reference = generatePayoutReference(transferId)
      const result = await this.fallback.initiatePayout({
        transferId,
        amount: transfer.receiveAmount,
        currency: transfer.receiveCurrency,
        bankCode: transfer.recipient.bankCode,
        accountNumber: transfer.recipient.accountNumber,
        recipientName: transfer.recipient.fullName,
        reference,
      })

      // Switch provider, set providerRef, and reset retryCount to -1 in one write.
      // The state machine increments retryCount on NGN_RETRY -> PROCESSING_NGN,
      // so -1 becomes 0 — a clean start for the new provider.
      await prisma.transfer.update({
        where: { id: transferId },
        data: {
          payoutProvider: 'PAYSTACK' as PayoutProviderEnum,
          payoutProviderRef: result.providerRef,
          retryCount: -1,
        },
      })

      const updated = await transitionTransfer({
        transferId,
        toStatus: TransferStatus.PROCESSING_NGN,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.NGN_RETRY,
        metadata: { provider: 'PAYSTACK', providerRef: result.providerRef },
      })

      return updated
    }

    // Paystack also exhausted: NEEDS_MANUAL
    // NGN_FAILED -> NEEDS_MANUAL
    return transitionTransfer({
      transferId,
      toStatus: TransferStatus.NEEDS_MANUAL,
      actor: ActorType.SYSTEM,
      expectedStatus: TransferStatus.NGN_FAILED,
      metadata: { reason, exhaustedProviders: ['FLUTTERWAVE', 'PAYSTACK'] },
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

    // Reset retryCount for fresh retry
    await prisma.transfer.update({
      where: { id: transferId },
      data: { retryCount: 0 },
    })

    // Select provider (use primary by default for manual retry)
    const provider = this.primary
    const reference = generatePayoutReference(transferId)

    const result = await provider.initiatePayout({
      transferId,
      amount: transfer.receiveAmount,
      currency: transfer.receiveCurrency,
      bankCode: transfer.recipient.bankCode,
      accountNumber: transfer.recipient.accountNumber,
      recipientName: transfer.recipient.fullName,
      reference,
    })

    await prisma.transfer.update({
      where: { id: transferId },
      data: {
        payoutProvider: provider.name as PayoutProviderEnum,
        payoutProviderRef: result.providerRef,
      },
    })

    // NEEDS_MANUAL -> PROCESSING_NGN
    return transitionTransfer({
      transferId,
      toStatus: TransferStatus.PROCESSING_NGN,
      actor: ActorType.ADMIN,
      actorId: adminId,
      expectedStatus: TransferStatus.NEEDS_MANUAL,
      metadata: { manualRetry: true, provider: provider.name, providerRef: result.providerRef },
    })
  }
}

export function getOrchestrator(): PayoutOrchestrator {
  const primary = new FlutterwaveProvider({
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY!,
    apiUrl: process.env.FLUTTERWAVE_API_URL ?? 'https://api.flutterwave.com/v3',
  })
  const fallback = new PaystackProvider({
    secretKey: process.env.PAYSTACK_SECRET_KEY!,
    apiUrl: process.env.PAYSTACK_API_URL ?? 'https://api.paystack.co',
  })
  return new PayoutOrchestrator(primary, fallback)
}
