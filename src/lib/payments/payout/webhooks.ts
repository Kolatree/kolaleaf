import crypto, { timingSafeEqual } from 'crypto'
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

export async function handleFlutterwaveWebhook(
  payload: unknown,
  signature: string,
  webhookSecret: string,
): Promise<void> {
  // Verify signature: Flutterwave sends the secret hash in verif-hash header
  const expected = Buffer.from(webhookSecret, 'utf-8')
  const received = Buffer.from(signature, 'utf-8')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Invalid Flutterwave webhook signature')
  }

  const body = payload as FlutterwaveWebhookPayload
  const eventId = String(body.data.id)
  const providerRef = eventId

  // Idempotency check
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: 'FLUTTERWAVE', eventId } },
  })
  if (existing) return

  // Store webhook event
  await prisma.webhookEvent.create({
    data: {
      provider: 'FLUTTERWAVE',
      eventId,
      eventType: body.event,
      payload: body as object,
      processed: false,
    },
  })

  // Find the transfer by provider ref
  const transfer = await prisma.transfer.findFirst({
    where: { payoutProviderRef: providerRef, payoutProvider: 'FLUTTERWAVE' },
  })

  if (transfer) {
    const orchestrator = await getOrchestrator() as WebhookOrchestrator

    if (body.data.status === 'SUCCESSFUL') {
      await orchestrator.handlePayoutSuccess(transfer.id)
    } else if (body.data.status === 'FAILED') {
      await orchestrator.handlePayoutFailure(
        transfer.id,
        body.data.complete_message ?? 'Transfer failed',
      )
    }
  }

  // Mark as processed
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

export async function handlePaystackWebhook(
  payload: unknown,
  signature: string,
  secretKey: string,
): Promise<void> {
  // Verify HMAC-SHA512 signature
  const expectedSignature = crypto
    .createHmac('sha512', secretKey)
    .update(JSON.stringify(payload))
    .digest('hex')

  const expectedBuf = Buffer.from(expectedSignature, 'hex')
  const receivedBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error('Invalid Paystack webhook signature')
  }

  const body = payload as PaystackWebhookPayload
  const eventId = body.data.transfer_code

  // Idempotency check
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: 'PAYSTACK', eventId } },
  })
  if (existing) return

  // Store webhook event
  await prisma.webhookEvent.create({
    data: {
      provider: 'PAYSTACK',
      eventId,
      eventType: body.event,
      payload: body as object,
      processed: false,
    },
  })

  // Find the transfer by provider ref
  const transfer = await prisma.transfer.findFirst({
    where: { payoutProviderRef: eventId, payoutProvider: 'PAYSTACK' },
  })

  if (transfer) {
    const orchestrator = await getOrchestrator() as WebhookOrchestrator

    if (body.data.status === 'success') {
      await orchestrator.handlePayoutSuccess(transfer.id)
    } else if (body.data.status === 'failed') {
      await orchestrator.handlePayoutFailure(
        transfer.id,
        body.data.reason ?? 'Transfer failed',
      )
    }
  }

  // Mark as processed
  await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: 'PAYSTACK', eventId } },
    data: { processed: true, processedAt: new Date() },
  })
}
