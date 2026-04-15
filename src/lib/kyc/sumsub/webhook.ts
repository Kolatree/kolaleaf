import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '../../db/client'
import { verifySumsubSignature } from './verify-signature'
import { handleKycApproved, handleKycRejected } from './kyc-service'

interface SumsubWebhookPayload {
  applicantId: string
  type: string
  reviewResult?: {
    reviewAnswer: string
    rejectLabels?: string[]
  }
}

// Handles a Sumsub KYC webhook.
//
// Security: Sumsub signs the raw HTTP body (the `x-payload-digest` header is
// HMAC-SHA256 over the exact bytes they send). Re-serializing a parsed
// payload can differ in whitespace and key order, breaking signature
// verification, so we verify against `rawBody`.
//
// Idempotency: uses the same create-as-lock pattern as the payment
// webhooks — see `src/lib/payments/monoova/webhook.ts` for the rationale.
export async function handleSumsubWebhook(
  rawBody: string,
  signature: string
): Promise<void> {
  const secret = process.env.SUMSUB_WEBHOOK_SECRET
  if (!secret) throw new Error('SUMSUB_WEBHOOK_SECRET not configured')

  // 1. Verify signature against the raw bytes the provider signed.
  if (!verifySumsubSignature(rawBody, signature, secret)) {
    throw new Error('Invalid webhook signature')
  }

  const data = JSON.parse(rawBody) as SumsubWebhookPayload
  const reviewAnswer = data.reviewResult?.reviewAnswer ?? 'unknown'
  const eventId = `${data.applicantId}:${data.type}:${reviewAnswer}`

  // 2. Atomically claim the event.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'sumsub',
        eventId,
        eventType: data.type,
        payload: data as unknown as object,
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

  // 3. Find user by kycProviderId (applicantId).
  const user = await prisma.user.findFirst({
    where: { kycProviderId: data.applicantId },
  })

  if (!user) {
    // Unknown applicant: keep the audit row, mark processed so we don't
    // retry; payload is preserved for investigation.
    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: 'sumsub', eventId } },
      data: { processed: true, processedAt: new Date() },
    })
    return
  }

  // 4. Route based on review result. Release the claim on failure so the
  //    provider's retry can re-enter.
  try {
    if (data.type === 'applicantReviewed' && data.reviewResult) {
      if (data.reviewResult.reviewAnswer === 'GREEN') {
        await handleKycApproved(user.id)
      } else if (data.reviewResult.reviewAnswer === 'RED') {
        await handleKycRejected(user.id, data.reviewResult.rejectLabels ?? [])
      }
    }
  } catch (err) {
    await prisma.webhookEvent.delete({
      where: { provider_eventId: { provider: 'sumsub', eventId } },
    })
    throw err
  }

  await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: 'sumsub', eventId } },
    data: { processed: true, processedAt: new Date() },
  })
}
