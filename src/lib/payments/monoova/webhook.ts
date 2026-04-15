import Decimal from 'decimal.js'
import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '../../db/client'
import { verifyMonoovaSignature } from './verify-signature'
import { handlePaymentReceived } from './payid-service'

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
// Idempotency: uses a "create-as-lock" pattern. The first delivery for a
// given eventId claims the WebhookEvent row via a unique-constraint
// protected insert. A concurrent duplicate delivery will hit `P2002` on the
// create and return immediately, so the state transition runs at most once.
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

  // 2. Atomically claim the event. If another delivery already claimed it,
  //    short-circuit.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'monoova',
        eventId: data.eventId,
        eventType: data.eventType,
        payload: data as unknown as object,
        processed: false,
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Duplicate delivery; another worker already owns this eventId.
      return
    }
    throw err
  }

  // 3. Find transfer by payIdReference.
  const transfer = await prisma.transfer.findFirst({
    where: { payidReference: data.payIdReference },
  })

  if (!transfer) {
    // Unknown reference: keep the audit row but do not process. Mark as
    // processed=true so the reconciliation worker doesn't retry it; the
    // payload is preserved for manual investigation.
    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: 'monoova', eventId: data.eventId } },
      data: { processed: true, processedAt: new Date() },
    })
    return
  }

  // 4. Process payment and mark processed. If processing throws, release
  //    the claim by deleting the WebhookEvent row so the provider's next
  //    retry can re-enter; otherwise we'd permanently short-circuit retries
  //    of a genuinely failed delivery.
  try {
    await handlePaymentReceived(transfer.id, new Decimal(data.amount))
  } catch (err) {
    await prisma.webhookEvent.delete({
      where: { provider_eventId: { provider: 'monoova', eventId: data.eventId } },
    })
    throw err
  }

  await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: 'monoova', eventId: data.eventId } },
    data: { processed: true, processedAt: new Date() },
  })
}
