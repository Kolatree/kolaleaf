import crypto, { timingSafeEqual } from 'crypto'
import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '../../db/client'

// Webhook handlers for BudPay + Flutterwave.
//
// BudPay is the primary NGN disburser; Flutterwave is the fallback.
// Both handlers share the create-as-lock idempotency pattern used by
// Monoova: a unique
// constraint on WebhookEvent(provider, eventId) ensures at-most-once
// processing even when the provider retries.

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
// (not an HMAC). The raw body is accepted for future-proofing and parity
// with the other providers, but the comparison is still secret-to-header.
//
// Idempotency: create-as-lock pattern (see monoova/webhook.ts).
export async function handleFlutterwaveWebhook(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<void> {
  const expected = Buffer.from(webhookSecret, 'utf-8')
  const received = Buffer.from(signature, 'utf-8')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
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

  // Atomically claim the event.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'FLUTTERWAVE',
        eventId,
        eventType: body.event,
        payload: body as unknown as object,
        processed: false,
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return
    }
    throw err
  }

  // Process. Release the claim on failure so provider retry can re-enter.
  try {
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
  } catch (err) {
    await prisma.webhookEvent.delete({
      where: { provider_eventId: { provider: 'FLUTTERWAVE', eventId } },
    })
    throw err
  }

  await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: 'FLUTTERWAVE', eventId } },
    data: { processed: true, processedAt: new Date() },
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
// merchant secret. Verifying against `rawBody` (not
// `JSON.stringify(payload)`) preserves whitespace and key order so a
// re-serialized body can't fail verification.
//
// Idempotency: create-as-lock pattern (see monoova/webhook.ts). The
// eventId is the payout `reference` we generated — it is unique per
// payout and echoed back by BudPay.
export async function handleBudPayWebhook(
  rawBody: string,
  signature: string,
  secretKey: string,
): Promise<void> {
  const expectedSignature = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex')

  const expectedBuf = Buffer.from(expectedSignature, 'hex')
  const receivedBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error('Invalid BudPay webhook signature')
  }

  const body = JSON.parse(rawBody) as BudPayWebhookPayload
  // Validate the event key before use. See the matching guard in
  // handleFlutterwaveWebhook — an empty-string reference would
  // permanently poison the dedup row for this provider.
  const eventId = body.data?.reference
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    throw new Error('BudPay webhook missing or empty data.reference')
  }
  const eventType = body.notify ?? body.event ?? 'transfer'

  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'BUDPAY',
        eventId,
        eventType,
        payload: body as unknown as object,
        processed: false,
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return
    }
    throw err
  }

  try {
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
  } catch (err) {
    await prisma.webhookEvent.delete({
      where: { provider_eventId: { provider: 'BUDPAY', eventId } },
    })
    throw err
  }

  await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: 'BUDPAY', eventId } },
    data: { processed: true, processedAt: new Date() },
  })
}
