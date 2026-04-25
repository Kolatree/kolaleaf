import Decimal from 'decimal.js'
import { verifyMonoovaSignature } from './verify-signature'
import { handlePaymentReceived } from './payid-service'
import { PermanentPaymentError } from '../../transfers/errors'
import { processWebhookEvent } from '../../webhooks/idempotent-handler'
import { prisma } from '../../db/client'

interface MonoovaWebhookPayload {
  eventId: string
  eventType: string
  payIdReference: string
  amount: number
  timestamp: string
}

// Handles a Monoova PayID webhook.
//
// Security: verifies the HMAC signature against the raw HTTP body (not
// `JSON.stringify(payload)`, which re-serializes and can differ in whitespace
// or key order).
//
// Idempotency: delegated to `processWebhookEvent` — see
// `src/lib/webhooks/idempotent-handler.ts` for the create-as-lock rationale.
export async function handleMonoovaWebhook(
  rawBody: string,
  signature: string
): Promise<void> {
  const secret = process.env.MONOOVA_WEBHOOK_SECRET
  if (!secret) throw new Error('MONOOVA_WEBHOOK_SECRET not configured')

  // 1. Verify signature against the raw bytes the provider signed.
  if (!verifyMonoovaSignature(rawBody, signature, secret)) {
    throw new Error('Invalid webhook signature')
  }

  const data = JSON.parse(rawBody) as MonoovaWebhookPayload

  await processWebhookEvent({
    provider: 'MONOOVA',
    eventId: data.eventId,
    eventType: data.eventType,
    payload: data,
    isPermanentError: (err) => err instanceof PermanentPaymentError,
    async process() {
      // Find transfer by payIdReference.
      const transfer = await prisma.transfer.findFirst({
        where: { payidReference: data.payIdReference },
      })

      if (!transfer) {
        // Unknown reference: keep the audit row but do not process.
        // processWebhookEvent will mark it processed on return.
        return
      }

      await handlePaymentReceived(transfer.id, new Decimal(data.amount))
    },
  })
}
