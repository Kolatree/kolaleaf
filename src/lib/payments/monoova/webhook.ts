import Decimal from 'decimal.js'
import { prisma } from '../../db/client.js'
import { verifyMonoovaSignature } from './verify-signature.js'
import { handlePaymentReceived } from './payid-service.js'

interface MonoovaWebhookPayload {
  eventId: string
  eventType: string
  payIdReference: string
  amount: number
  timestamp: string
}

export async function handleMonoovaWebhook(
  payload: unknown,
  signature: string
): Promise<void> {
  const secret = process.env.MONOOVA_WEBHOOK_SECRET
  if (!secret) throw new Error('MONOOVA_WEBHOOK_SECRET not configured')

  const payloadStr = JSON.stringify(payload)

  // 1. Verify signature
  if (!verifyMonoovaSignature(payloadStr, signature, secret)) {
    throw new Error('Invalid webhook signature')
  }

  const data = payload as MonoovaWebhookPayload

  // 2. Idempotency check
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: 'monoova', eventId: data.eventId } },
  })

  if (existing) {
    // Already processed, skip
    return
  }

  // 3. Find transfer by payIdReference
  const transfer = await prisma.transfer.findFirst({
    where: { payidReference: data.payIdReference },
  })

  if (!transfer) {
    // Unknown reference: store for audit but don't error
    await prisma.webhookEvent.create({
      data: {
        provider: 'monoova',
        eventId: data.eventId,
        eventType: data.eventType,
        payload: payload as object,
        processed: false,
        processedAt: new Date(),
      },
    })
    return
  }

  // 4. Process payment
  try {
    await handlePaymentReceived(transfer.id, new Decimal(data.amount))

    // 5. Store as processed
    await prisma.webhookEvent.create({
      data: {
        provider: 'monoova',
        eventId: data.eventId,
        eventType: data.eventType,
        payload: payload as object,
        processed: true,
        processedAt: new Date(),
      },
    })
  } catch (error) {
    // Store webhook event as unprocessed for audit trail, then re-throw
    await prisma.webhookEvent.create({
      data: {
        provider: 'monoova',
        eventId: data.eventId,
        eventType: data.eventType,
        payload: payload as object,
        processed: false,
        processedAt: new Date(),
      },
    })
    throw error
  }
}
