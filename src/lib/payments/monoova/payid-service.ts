import Decimal from 'decimal.js'
import { prisma } from '../../db/client'
import { transitionTransfer } from '../../transfers/state-machine'
import {
  ConcurrentModificationError,
  TransferNotFoundError,
  KycNotVerifiedError,
} from '../../transfers/errors'
import { isKycGateDisabled } from '../../kyc/flag'
import { isStubProvidersEnabled } from '../flag'
import { log } from '../../obs/logger'
import type { MonoovaClient } from './client'
import type { Transfer } from '../../../generated/prisma/client'
import { FloatMonitor } from '../payout/float-monitor'
import { FlutterwaveProvider } from '../payout/flutterwave'

const AMOUNT_TOLERANCE = new Decimal('0.01')

export async function generatePayIdForTransfer(
  transferId: string,
  client: MonoovaClient
): Promise<Transfer> {
  const transfer = await prisma.transfer.findUnique({ where: { id: transferId } })
  if (!transfer) throw new TransferNotFoundError(transferId)

  // KYC gate moved here (Wave 1 audit gap #18). Transfer creation
  // is allowed without KYC — we let users draft a CREATED transfer
  // and prompt verification afterwards. But PayID issuance is the
  // point where we become a money handler, so AUSTRAC requires a
  // VERIFIED applicant before we start collecting AUD.
  //
  // KOLA_DISABLE_KYC_GATE is a dev-only escape hatch to unblock
  // transaction-flow testing before Sumsub keys land. Never set
  // this in production.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: transfer.userId } })
  if (!isKycGateDisabled() && user.kycStatus !== 'VERIFIED') {
    throw new KycNotVerifiedError(transfer.userId)
  }

  if (transfer.status !== 'CREATED') {
    throw new Error(`Transfer ${transferId} is not in CREATED state`)
  }

  // Generate PayID reference: KL-{transferId}-{timestamp}
  const reference = `KL-${transferId}-${Date.now()}`

  // Call Monoova outside a DB transaction. Holding an interactive
  // transaction open across a provider call causes the transaction to
  // expire under realistic latency and can leave the app claiming the
  // PayID step exists when it never committed locally.
  const result = await client.createPayId({
    transferId,
    amount: new Decimal(transfer.sendAmount.toString()),
    reference,
  })

  const updated = await prisma.transfer.updateMany({
    where: { id: transferId, status: 'CREATED' },
    data: {
      payidReference: result.payIdReference,
      payidProviderRef: result.payId,
    },
  })

  if (updated.count === 0) {
    throw new ConcurrentModificationError(transferId)
  }

  return transitionTransfer({
    transferId,
    toStatus: 'AWAITING_AUD',
    actor: 'SYSTEM',
    expectedStatus: 'CREATED',
    metadata: {
      payidReference: result.payIdReference,
      payidProviderRef: result.payId,
    },
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
  const audReceived = await transitionTransfer({
    transferId,
    toStatus: 'AUD_RECEIVED',
    actor: 'SYSTEM',
    expectedStatus: 'AWAITING_AUD',
    metadata: {
      receivedAmount: receivedAmount.toFixed(2),
      expectedAmount: expectedAmount.toFixed(2),
    },
  })

  try {
    const floatMonitor = new FloatMonitor(
      new FlutterwaveProvider({
        secretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? '',
        apiUrl: process.env.FLUTTERWAVE_API_URL ?? 'https://api.flutterwave.com/v3',
      }),
    )
    const floatStatus = await floatMonitor.checkFloatBalance()
    if (!floatStatus.sufficient) {
      return transitionTransfer({
        transferId,
        toStatus: 'FLOAT_INSUFFICIENT',
        actor: 'SYSTEM',
        expectedStatus: 'AUD_RECEIVED',
        metadata: {
          reason: 'Float balance below threshold',
          provider: floatStatus.provider,
          balance: floatStatus.balance.toString(),
          threshold: process.env.MIN_FLOAT_BALANCE_NGN ?? '500000',
        },
      })
    }
  } catch (err) {
    log('error', 'float.preflight.failed', {
      transferId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Kick off payout orchestration. The call is awaited so a stub-mode
  // run can cascade to COMPLETED in one pass, but errors are caught
  // and logged so a provider outage cannot block the webhook worker
  // from ack'ing — the transfer stays in AUD_RECEIVED and the
  // reconciliation cron will surface it.
  //
  // Lazy import of the orchestrator avoids a circular-dependency pitfall:
  // orchestrator.ts → budpay.ts + flutterwave.ts, both of which live in
  // the same payments/ tree that transitively imports this file. The
  // import() call materialises the module only at first use.
  try {
    const { getOrchestrator } = await import('../payout/orchestrator')
    const orchestrator = getOrchestrator()
    await orchestrator.initiatePayout(transferId)

    // Stub mode: no real provider webhook will arrive to drive
    // PROCESSING_NGN → NGN_SENT → COMPLETED, so synthesise success
    // inline. Real mode relies on the provider's webhook.
    if (isStubProvidersEnabled()) {
      return await orchestrator.handlePayoutSuccess(transferId)
    }
    // Real mode: return the AUD_RECEIVED snapshot the caller expected.
    // The orchestrator has already advanced the row to PROCESSING_NGN
    // but callers of handlePaymentReceived only contract on "payment
    // acknowledged", not on payout status.
    return audReceived
  } catch (err) {
    log('error', 'payout.kickoff.failed', {
      transferId,
      error: err instanceof Error ? err.message : String(err),
    })
    return audReceived
  }
}
