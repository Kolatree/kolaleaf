import { processWebhookEvent } from '../../webhooks/idempotent-handler'
import { prisma } from '../../db/client'
import { verifyFlutterwaveSignature, verifyBudPaySignature } from './verify-signature'

// Webhook handlers for BudPay + Flutterwave.
//
// BudPay is the primary NGN disburser; Flutterwave is the fallback.
// Both handlers delegate idempotency to `processWebhookEvent`.

// Lazy import to allow mocking in tests
async function getOrchestrator() {
  const mod = await import('./orchestrator')
  return mod.getOrchestrator()
}

interface WebhookOrchestrator {
  handlePayoutSuccess(transferId: string): Promise<unknown>
  handlePayoutFailure(transferId: string, reason: string): Promise<unknown>
}

// ─── Flutterwave ─────────────────────────────────────

interface FlutterwaveWebhookPayload {
  event: string
  data: {
    id: number
    reference: string
    status: string
    complete_message?: string
  }
}

// Handles a Flutterwave payout webhook.
//
// Security: Flutterwave's `verif-hash` header is the static webhook secret
// (not an HMAC). Verified via `verifyFlutterwaveSignature`.
//
// Idempotency: delegated to `processWebhookEvent`.
export async function handleFlutterwaveWebhook(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<void> {
  if (!verifyFlutterwaveSignature(signature, webhookSecret)) {
    throw new Error('Invalid Flutterwave webhook signature')
  }

  const body = JSON.parse(rawBody) as FlutterwaveWebhookPayload
  // Validate the event key before use. An empty/missing `data.id`
  // would otherwise poison the (provider, eventId) unique constraint
  // with a row keyed on `'undefined'` / `''` that would silently
  // short-circuit every subsequent malformed delivery as "duplicate."
  if (body.data?.id === undefined || body.data?.id === null) {
    throw new Error('Flutterwave webhook missing data.id')
  }
  const eventId = String(body.data.id)
  if (eventId === '' || eventId === 'undefined' || eventId === 'null') {
    throw new Error('Flutterwave webhook has empty data.id')
  }
  const providerRef = eventId

  await processWebhookEvent({
    provider: 'FLUTTERWAVE',
    eventId,
    eventType: body.event,
    payload: body,
    async process() {
      const transfer = await prisma.transfer.findFirst({
        where: { payoutProviderRef: providerRef, payoutProvider: 'FLUTTERWAVE' },
      })

      if (transfer) {
        const orchestrator = (await getOrchestrator()) as WebhookOrchestrator

        if (body.data.status === 'SUCCESSFUL') {
          await orchestrator.handlePayoutSuccess(transfer.id)
        } else if (body.data.status === 'FAILED') {
          await orchestrator.handlePayoutFailure(
            transfer.id,
            body.data.complete_message ?? 'Transfer failed',
          )
        }
      }
    },
  })
}

// ─── BudPay ──────────────────────────────────────────

interface BudPayWebhookPayload {
  notify?: string
  // BudPay's documented envelope is `{ notify: 'transfer', data: { ... } }`.
  // We keep the event type on an optional `event` alias too so older
  // docs / sandbox payloads that use `event` still parse.
  event?: string
  data: {
    reference: string
    status: string
    reason?: string
    amount?: string | number
    currency?: string
    fee?: string | number
  }
}

// Handles a BudPay payout webhook.
//
// Security: HMAC-SHA512 over the raw HTTP body, keyed on the BudPay
// merchant secret. Verified via `verifyBudPaySignature`.
//
// Idempotency: delegated to `processWebhookEvent`.
export async function handleBudPayWebhook(
  rawBody: string,
  signature: string,
  secretKey: string,
): Promise<void> {
  if (!verifyBudPaySignature(rawBody, signature, secretKey)) {
    throw new Error('Invalid BudPay webhook signature')
  }

  const body = JSON.parse(rawBody) as BudPayWebhookPayload
  // Validate the event key before use. See the matching guard in
  // handleFlutterwaveWebhook -- an empty-string reference would
  // permanently poison the dedup row for this provider.
  const eventId = body.data?.reference
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    throw new Error('BudPay webhook missing or empty data.reference')
  }
  const eventType = body.notify ?? body.event ?? 'transfer'

  await processWebhookEvent({
    provider: 'BUDPAY',
    eventId,
    eventType,
    payload: body,
    async process() {
      const transfer = await prisma.transfer.findFirst({
        where: { payoutProviderRef: eventId, payoutProvider: 'BUDPAY' },
      })

      if (transfer) {
        const orchestrator = (await getOrchestrator()) as WebhookOrchestrator

        if (body.data.status === 'success') {
          await orchestrator.handlePayoutSuccess(transfer.id)
        } else if (body.data.status === 'failed') {
          await orchestrator.handlePayoutFailure(
            transfer.id,
            body.data.reason ?? 'Transfer failed',
          )
        }
      }
    },
  })
}
