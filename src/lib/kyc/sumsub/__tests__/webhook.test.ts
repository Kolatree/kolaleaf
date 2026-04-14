import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { handleSumsubWebhook } from '../webhook'

vi.mock('../../../db/client', () => ({
  prisma: {
    webhookEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('../kyc-service', () => ({
  handleKycApproved: vi.fn(),
  handleKycRejected: vi.fn(),
}))

vi.mock('../verify-signature', () => ({
  verifySumsubSignature: vi.fn(),
}))

import { prisma } from '../../../db/client'
import { handleKycApproved, handleKycRejected } from '../kyc-service'
import { verifySumsubSignature } from '../verify-signature'

const WEBHOOK_SECRET = 'test-sumsub-webhook-secret'

function makeApprovedPayload(overrides: Record<string, unknown> = {}) {
  return {
    applicantId: 'applicant-abc-123',
    inspectionId: 'insp-001',
    applicantType: 'individual',
    correlationId: 'corr-001',
    externalUserId: 'user-001',
    type: 'applicantReviewed',
    reviewResult: {
      reviewAnswer: 'GREEN',
    },
    reviewStatus: 'completed',
    createdAt: '2025-01-15T10:30:00.000Z',
    ...overrides,
  }
}

function makeRejectedPayload(overrides: Record<string, unknown> = {}) {
  return {
    ...makeApprovedPayload(),
    reviewResult: {
      reviewAnswer: 'RED',
      rejectLabels: ['ID_INVALID', 'SELFIE_MISMATCH'],
    },
    ...overrides,
  }
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
}

describe('handleSumsubWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUMSUB_WEBHOOK_SECRET', WEBHOOK_SECRET)
  })

  it('processes an approved webhook end-to-end', async () => {
    const payload = makeApprovedPayload()
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifySumsubSignature).mockReturnValue(true)

    // No existing event (not duplicate)
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null)

    // User found by kycProviderId
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-001',
      kycProviderId: 'applicant-abc-123',
    } as any)

    vi.mocked(handleKycApproved).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)

    await handleSumsubWebhook(payload, signature)

    // Signature verified
    expect(verifySumsubSignature).toHaveBeenCalledWith(payloadStr, signature, WEBHOOK_SECRET)

    // Idempotency check
    expect(prisma.webhookEvent.findUnique).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'sumsub', eventId: 'applicant-abc-123:applicantReviewed:GREEN' } },
    })

    // User lookup
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { kycProviderId: 'applicant-abc-123' },
    })

    // Routed to approved handler
    expect(handleKycApproved).toHaveBeenCalledWith('user-001')
    expect(handleKycRejected).not.toHaveBeenCalled()

    // Webhook event stored as processed
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'sumsub',
        eventId: 'applicant-abc-123:applicantReviewed:GREEN',
        eventType: 'applicantReviewed',
        processed: true,
      }),
    })
  })

  it('processes a rejected webhook correctly', async () => {
    const payload = makeRejectedPayload()
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifySumsubSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-001',
      kycProviderId: 'applicant-abc-123',
    } as any)
    vi.mocked(handleKycRejected).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)

    await handleSumsubWebhook(payload, signature)

    expect(handleKycRejected).toHaveBeenCalledWith('user-001', ['ID_INVALID', 'SELFIE_MISMATCH'])
    expect(handleKycApproved).not.toHaveBeenCalled()
  })

  it('skips duplicate webhook (idempotency)', async () => {
    const payload = makeApprovedPayload()
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifySumsubSignature).mockReturnValue(true)

    // Existing event — duplicate
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue({
      id: 'wh-existing',
      provider: 'sumsub',
      eventId: 'applicant-abc-123:applicantReviewed:GREEN',
      processed: true,
    } as any)

    await handleSumsubWebhook(payload, signature)

    expect(handleKycApproved).not.toHaveBeenCalled()
    expect(handleKycRejected).not.toHaveBeenCalled()
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled()
  })

  it('rejects invalid signature', async () => {
    const payload = makeApprovedPayload()

    vi.mocked(verifySumsubSignature).mockReturnValue(false)

    await expect(
      handleSumsubWebhook(payload, 'bad-signature')
    ).rejects.toThrow('Invalid webhook signature')

    expect(prisma.webhookEvent.findUnique).not.toHaveBeenCalled()
    expect(handleKycApproved).not.toHaveBeenCalled()
  })

  it('logs but does not throw for unknown applicant', async () => {
    const payload = makeApprovedPayload({ applicantId: 'unknown-applicant' })
    const payloadStr = JSON.stringify(payload)
    const signature = signPayload(payloadStr)

    vi.mocked(verifySumsubSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null) // not found
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)

    // Should NOT throw
    await handleSumsubWebhook(payload, signature)

    expect(handleKycApproved).not.toHaveBeenCalled()

    // Webhook event still stored for audit
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'sumsub',
        eventId: 'unknown-applicant:applicantReviewed:GREEN',
        processed: false,
      }),
    })
  })
})
