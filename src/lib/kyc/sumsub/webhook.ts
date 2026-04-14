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

export async function handleSumsubWebhook(
  payload: unknown,
  signature: string
): Promise<void> {
  const secret = process.env.SUMSUB_WEBHOOK_SECRET
  if (!secret) throw new Error('SUMSUB_WEBHOOK_SECRET not configured')

  const payloadStr = JSON.stringify(payload)

  // 1. Verify signature
  if (!verifySumsubSignature(payloadStr, signature, secret)) {
    throw new Error('Invalid webhook signature')
  }

  const data = payload as SumsubWebhookPayload
  const reviewAnswer = data.reviewResult?.reviewAnswer ?? 'unknown'
  const eventId = `${data.applicantId}:${data.type}:${reviewAnswer}`

  // 2. Idempotency check
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: 'sumsub', eventId } },
  })

  if (existing) {
    return
  }

  // 3. Find user by kycProviderId (applicantId)
  const user = await prisma.user.findFirst({
    where: { kycProviderId: data.applicantId },
  })

  if (!user) {
    await prisma.webhookEvent.create({
      data: {
        provider: 'sumsub',
        eventId,
        eventType: data.type,
        payload: payload as object,
        processed: false,
        processedAt: new Date(),
      },
    })
    return
  }

  // 4. Route based on review result
  try {
    if (data.type === 'applicantReviewed' && data.reviewResult) {
      if (data.reviewResult.reviewAnswer === 'GREEN') {
        await handleKycApproved(user.id)
      } else if (data.reviewResult.reviewAnswer === 'RED') {
        await handleKycRejected(user.id, data.reviewResult.rejectLabels ?? [])
      }
    }

    // 5. Store as processed
    await prisma.webhookEvent.create({
      data: {
        provider: 'sumsub',
        eventId,
        eventType: data.type,
        payload: payload as object,
        processed: true,
        processedAt: new Date(),
      },
    })
  } catch (error) {
    await prisma.webhookEvent.create({
      data: {
        provider: 'sumsub',
        eventId,
        eventType: data.type,
        payload: payload as object,
        processed: false,
        processedAt: new Date(),
      },
    })
    throw error
  }
}
