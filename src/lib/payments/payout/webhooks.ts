import crypto, { timingSafeEqual } from 'crypto'
import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '../../db/client'

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
  const eventId = String(body.data.id)
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

// ─── Paystack ────────────────────────────────────────

interface PaystackWebhookPayload {
  event: string
  data: {
    transfer_code: string
    reference: string
    status: string
    reason?: string
  }
}

// Handles a Paystack payout webhook.
//
// Security: HMAC-SHA512 over the raw HTTP body, keyed on the secret key.
// Signing `JSON.stringify(payload)` on a re-parsed body can differ from the
// original bytes (whitespace, key order), breaking verification — so we
// verify against `rawBody` directly.
//
// Idempotency: create-as-lock pattern (see monoova/webhook.ts).
export async function handlePaystackWebhook(
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
    throw new Error('Invalid Paystack webhook signature')
  }

  const body = JSON.parse(rawBody) as PaystackWebhookPayload
  const eventId = body.data.transfer_code

  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'PAYSTACK',
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

  try {
    const transfer = await prisma.transfer.findFirst({
      where: { payoutProviderRef: eventId, payoutProvider: 'PAYSTACK' },
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
      where: { provider_eventId: { provider: 'PAYSTACK', eventId } },
    })
    throw err
  }

  await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: 'PAYSTACK', eventId } },
    data: { processed: true, processedAt: new Date() },
  })
}
