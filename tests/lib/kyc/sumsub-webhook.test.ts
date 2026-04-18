import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

vi.mock('@/lib/obs/logger', () => ({
  log: vi.fn(),
}))

import { prisma as testDb } from '../../e2e/helpers'
import { handleSumsubWebhook } from '@/lib/kyc/sumsub/webhook'
import { log } from '@/lib/obs/logger'

const mockLog = vi.mocked(log)
const SECRET = 'test-sumsub-secret'

function signPayload(raw: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex')
}

async function seedUser(applicantId: string): Promise<string> {
  const u = await testDb.user.create({
    data: {
      fullName: `Sumsub Test ${crypto.randomUUID()}`,
      passwordHash: 'x',
      kycStatus: 'IN_REVIEW',
      kycProviderId: applicantId,
    },
  })
  return u.id
}

describe('handleSumsubWebhook — widened event coverage (Step 27)', () => {
  const originalSecret = process.env.SUMSUB_WEBHOOK_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUMSUB_WEBHOOK_SECRET = SECRET
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.SUMSUB_WEBHOOK_SECRET
    else process.env.SUMSUB_WEBHOOK_SECRET = originalSecret
  })

  it('logs kyc.needs_additional_checks for YELLOW reviewAnswer and does NOT change kycStatus', async () => {
    const applicantId = `apl_${crypto.randomUUID()}`
    const userId = await seedUser(applicantId)
    const body = JSON.stringify({
      applicantId,
      type: 'applicantReviewed',
      reviewResult: { reviewAnswer: 'YELLOW' },
    })
    await handleSumsubWebhook(body, signPayload(body, SECRET))
    expect(mockLog).toHaveBeenCalledWith(
      'warn',
      'kyc.needs_additional_checks',
      expect.objectContaining({ userId, applicantId, reviewAnswer: 'YELLOW' }),
    )
    const u = await testDb.user.findUniqueOrThrow({ where: { id: userId } })
    expect(u.kycStatus).toBe('IN_REVIEW')
    await testDb.user.delete({ where: { id: userId } })
  })

  it('logs kyc.pending for applicantPending events', async () => {
    const applicantId = `apl_${crypto.randomUUID()}`
    const userId = await seedUser(applicantId)
    const body = JSON.stringify({ applicantId, type: 'applicantPending' })
    await handleSumsubWebhook(body, signPayload(body, SECRET))
    expect(mockLog).toHaveBeenCalledWith(
      'info',
      'kyc.pending',
      expect.objectContaining({ userId, applicantId }),
    )
    await testDb.user.delete({ where: { id: userId } })
  })

  it('logs kyc.applicant_created for applicantCreated events', async () => {
    const applicantId = `apl_${crypto.randomUUID()}`
    const userId = await seedUser(applicantId)
    const body = JSON.stringify({ applicantId, type: 'applicantCreated' })
    await handleSumsubWebhook(body, signPayload(body, SECRET))
    expect(mockLog).toHaveBeenCalledWith(
      'info',
      'kyc.applicant_created',
      expect.objectContaining({ userId, applicantId }),
    )
    await testDb.user.delete({ where: { id: userId } })
  })

  it('logs kyc.event.unhandled for any other event type', async () => {
    const applicantId = `apl_${crypto.randomUUID()}`
    const userId = await seedUser(applicantId)
    const body = JSON.stringify({ applicantId, type: 'applicantReset' })
    await handleSumsubWebhook(body, signPayload(body, SECRET))
    expect(mockLog).toHaveBeenCalledWith(
      'info',
      'kyc.event.unhandled',
      expect.objectContaining({ userId, applicantId, eventType: 'applicantReset' }),
    )
    await testDb.user.delete({ where: { id: userId } })
  })
})

import { afterAll } from 'vitest'
