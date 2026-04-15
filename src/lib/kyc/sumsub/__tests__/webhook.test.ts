import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleSumsubWebhook } from '../webhook'

vi.mock('../../../db/client', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('../../../../generated/prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string
    constructor(message: string, opts: { code: string }) {
      super(message)
      this.code = opts.code
    }
  }
  return {
    Prisma: {
      PrismaClientKnownRequestError,
    },
  }
})

vi.mock('../kyc-service', () => ({
  handleKycApproved: vi.fn(),
  handleKycRejected: vi.fn(),
}))

vi.mock('../verify-signature', () => ({
  verifySumsubSignature: vi.fn(),
}))

import { prisma } from '../../../db/client'
import { Prisma } from '../../../../generated/prisma/client'
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

describe('handleSumsubWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUMSUB_WEBHOOK_SECRET', WEBHOOK_SECRET)
  })

  it('processes an approved webhook end-to-end', async () => {
    const rawBody = JSON.stringify(makeApprovedPayload())
    const signature = 'any-signature'

    vi.mocked(verifySumsubSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-001',
      kycProviderId: 'applicant-abc-123',
    } as any)
    vi.mocked(handleKycApproved).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as any)

    await handleSumsubWebhook(rawBody, signature)

    // Signature verified against the raw body
    expect(verifySumsubSignature).toHaveBeenCalledWith(rawBody, signature, WEBHOOK_SECRET)

    // Claim-row insert
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'sumsub',
        eventId: 'applicant-abc-123:applicantReviewed:GREEN',
        eventType: 'applicantReviewed',
        processed: false,
      }),
    })

    // User lookup
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { kycProviderId: 'applicant-abc-123' },
    })

    // Routed to approved handler
    expect(handleKycApproved).toHaveBeenCalledWith('user-001')
    expect(handleKycRejected).not.toHaveBeenCalled()

    // Marked processed
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'sumsub', eventId: 'applicant-abc-123:applicantReviewed:GREEN' } },
      data: expect.objectContaining({ processed: true }),
    })
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled()
  })

  it('processes a rejected webhook correctly', async () => {
    const rawBody = JSON.stringify(makeRejectedPayload())

    vi.mocked(verifySumsubSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-001',
      kycProviderId: 'applicant-abc-123',
    } as any)
    vi.mocked(handleKycRejected).mockResolvedValue({} as any)
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as any)

    await handleSumsubWebhook(rawBody, 'sig')

    expect(handleKycRejected).toHaveBeenCalledWith('user-001', ['ID_INVALID', 'SELFIE_MISMATCH'])
    expect(handleKycApproved).not.toHaveBeenCalled()
  })

  it('skips duplicate webhook via P2002 (idempotency)', async () => {
    const rawBody = JSON.stringify(makeApprovedPayload())

    vi.mocked(verifySumsubSignature).mockReturnValue(true)

    vi.mocked(prisma.webhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002' } as any)
    )

    await handleSumsubWebhook(rawBody, 'sig')

    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(handleKycApproved).not.toHaveBeenCalled()
    expect(handleKycRejected).not.toHaveBeenCalled()
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled()
  })

  it('rejects invalid signature', async () => {
    const rawBody = JSON.stringify(makeApprovedPayload())
    vi.mocked(verifySumsubSignature).mockReturnValue(false)

    await expect(
      handleSumsubWebhook(rawBody, 'bad-signature')
    ).rejects.toThrow('Invalid webhook signature')

    expect(prisma.webhookEvent.create).not.toHaveBeenCalled()
    expect(handleKycApproved).not.toHaveBeenCalled()
  })

  it('marks processed but does not throw for unknown applicant', async () => {
    const rawBody = JSON.stringify(makeApprovedPayload({ applicantId: 'unknown-applicant' }))

    vi.mocked(verifySumsubSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as any)

    await handleSumsubWebhook(rawBody, 'sig')

    expect(handleKycApproved).not.toHaveBeenCalled()

    // Audit row marked processed
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'sumsub', eventId: 'unknown-applicant:applicantReviewed:GREEN' } },
      data: expect.objectContaining({ processed: true }),
    })
  })

  it('releases the claim (deletes) when processing throws', async () => {
    const rawBody = JSON.stringify(makeApprovedPayload())

    vi.mocked(verifySumsubSignature).mockReturnValue(true)
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-001',
      kycProviderId: 'applicant-abc-123',
    } as any)
    vi.mocked(handleKycApproved).mockRejectedValue(new Error('boom'))
    vi.mocked(prisma.webhookEvent.delete).mockResolvedValue({} as any)

    await expect(
      handleSumsubWebhook(rawBody, 'sig')
    ).rejects.toThrow('boom')

    expect(prisma.webhookEvent.delete).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'sumsub', eventId: 'applicant-abc-123:applicantReviewed:GREEN' } },
    })
    expect(prisma.webhookEvent.update).not.toHaveBeenCalled()
  })
})
