import { verifySumsubSignature } from './verify-signature'
import { handleKycApproved, handleKycRejected } from './kyc-service'
import { log } from '@/lib/obs/logger'
import { processWebhookEvent } from '../../webhooks/idempotent-handler'
import { prisma } from '../../db/client'

interface SumsubWebhookPayload {
  applicantId: string
  type: string
  correlationId?: string
  inspectionId?: string
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
// Idempotency: delegated to `processWebhookEvent` — see
// `src/lib/webhooks/idempotent-handler.ts` for the create-as-lock rationale.
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
  // Prefer correlationId (globally unique per Sumsub delivery). Fall back
  // to a composite key that includes inspectionId as a tiebreaker so
  // re-KYC events for the same applicant+type+answer don't collide.
  // When inspectionId is also absent, omit the tiebreaker to preserve
  // idempotency for identical retries of the same event.
  const fallbackKey = data.inspectionId
    ? `${data.applicantId}:${data.type}:${reviewAnswer}:${data.inspectionId}`
    : `${data.applicantId}:${data.type}:${reviewAnswer}`
  const eventId = data.correlationId ?? fallbackKey

  await processWebhookEvent({
    provider: 'SUMSUB',
    eventId,
    eventType: data.type,
    payload: data,
    async process() {
      // Find user by kycProviderId (applicantId).
      const user = await prisma.user.findFirst({
        where: { kycProviderId: data.applicantId },
      })

      if (!user) {
        // Unknown applicant: keep the audit row, processWebhookEvent
        // will mark processed so we don't retry.
        return
      }

      // Route based on event type. Non-terminal event types (pending,
      // created, reviewed/YELLOW = manual checks required) produce a log
      // line so ops has visibility without clobbering kycStatus -- status
      // only flips on GREEN or RED.
      if (data.type === 'applicantReviewed' && data.reviewResult) {
        if (data.reviewResult.reviewAnswer === 'GREEN') {
          await handleKycApproved(user.id)
        } else if (data.reviewResult.reviewAnswer === 'RED') {
          await handleKycRejected(user.id, data.reviewResult.rejectLabels ?? [])
        } else {
          // YELLOW + any other non-terminal answer: Sumsub signalling
          // "additional checks required" or similar. Leave kycStatus alone
          // (user stays IN_REVIEW); surface to ops via log.
          log('warn', 'kyc.needs_additional_checks', {
            userId: user.id,
            applicantId: data.applicantId,
            reviewAnswer: data.reviewResult.reviewAnswer,
            rejectLabels: data.reviewResult.rejectLabels ?? [],
          })
        }
      } else if (data.type === 'applicantPending') {
        log('info', 'kyc.pending', { userId: user.id, applicantId: data.applicantId })
      } else if (data.type === 'applicantCreated') {
        log('info', 'kyc.applicant_created', { userId: user.id, applicantId: data.applicantId })
      } else {
        log('info', 'kyc.event.unhandled', {
          userId: user.id,
          applicantId: data.applicantId,
          eventType: data.type,
        })
      }
    },
  })
}
