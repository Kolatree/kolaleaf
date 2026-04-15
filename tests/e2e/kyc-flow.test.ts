import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  prisma,
  registerTestUser,
  getTestCorridorId,
  createTestRecipient,
  cleanupTestData,
  hmacSha256,
} from './helpers'
import { handleKycApproved, handleKycRejected, retryKyc, getKycStatus } from '../../src/lib/kyc/sumsub/kyc-service'
import { handleSumsubWebhook } from '../../src/lib/kyc/sumsub/webhook'
import { createTransfer } from '../../src/lib/transfers/create'
import { KycNotVerifiedError } from '../../src/lib/transfers/errors'
import Decimal from 'decimal.js'

let corridorId: string

beforeAll(async () => {
  await cleanupTestData()
  corridorId = await getTestCorridorId()
})

afterEach(async () => {
  await prisma.webhookEvent.deleteMany({})
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
  await prisma.recipient.deleteMany({})
  await prisma.authEvent.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.userIdentifier.deleteMany({})
  await prisma.user.deleteMany({})
})

afterAll(async () => {
  await cleanupTestData()
  await prisma.$disconnect()
})

describe('KYC Flow E2E', () => {
  it('register → Sumsub approved webhook → VERIFIED → can create transfer', async () => {
    const { user } = await registerTestUser({ kycStatus: 'PENDING' })

    // Set kycProviderId (simulating initiateKyc call)
    const applicantId = `applicant-${Date.now()}`
    await prisma.user.update({
      where: { id: user.id },
      data: { kycStatus: 'IN_REVIEW', kycProviderId: applicantId },
    })

    // Simulate Sumsub approved webhook
    const webhookSecret = 'test-sumsub-secret'
    const originalEnv = process.env.SUMSUB_WEBHOOK_SECRET
    process.env.SUMSUB_WEBHOOK_SECRET = webhookSecret

    const rawBody = JSON.stringify({
      applicantId,
      type: 'applicantReviewed',
      reviewResult: { reviewAnswer: 'GREEN' },
    })
    const signature = hmacSha256(rawBody, webhookSecret)

    try {
      await handleSumsubWebhook(rawBody, signature)
    } finally {
      process.env.SUMSUB_WEBHOOK_SECRET = originalEnv
    }

    // Verify user is now VERIFIED
    const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(verifiedUser.kycStatus).toBe('VERIFIED')

    // Webhook event stored
    const webhookEvent = await prisma.webhookEvent.findFirst({
      where: { provider: 'sumsub' },
    })
    expect(webhookEvent).not.toBeNull()
    expect(webhookEvent!.processed).toBe(true)

    // Now the user CAN create a transfer
    const recipient = await createTestRecipient(user.id)
    const transfer = await createTransfer({
      userId: user.id,
      recipientId: recipient.id,
      corridorId,
      sendAmount: new Decimal(100),
      exchangeRate: new Decimal(1042.65),
      fee: new Decimal(5),
    })
    expect(transfer.status).toBe('CREATED')
  })

  it('register → Sumsub rejected webhook → REJECTED → retry KYC → approved', async () => {
    const { user } = await registerTestUser({ kycStatus: 'PENDING' })

    const applicantId = `applicant-rej-${Date.now()}`
    await prisma.user.update({
      where: { id: user.id },
      data: { kycStatus: 'IN_REVIEW', kycProviderId: applicantId },
    })

    // Simulate Sumsub rejected webhook
    const webhookSecret = 'test-sumsub-secret'
    const originalEnv = process.env.SUMSUB_WEBHOOK_SECRET
    process.env.SUMSUB_WEBHOOK_SECRET = webhookSecret

    const rejRawBody = JSON.stringify({
      applicantId,
      type: 'applicantReviewed',
      reviewResult: {
        reviewAnswer: 'RED',
        rejectLabels: ['DOCUMENT_MISMATCH', 'BLURRY_PHOTO'],
      },
    })
    const rejSignature = hmacSha256(rejRawBody, webhookSecret)

    try {
      await handleSumsubWebhook(rejRawBody, rejSignature)
    } finally {
      process.env.SUMSUB_WEBHOOK_SECRET = originalEnv
    }

    // Verify REJECTED
    const rejectedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(rejectedUser.kycStatus).toBe('REJECTED')
    expect(rejectedUser.kycRejectionReasons).toEqual(['DOCUMENT_MISMATCH', 'BLURRY_PHOTO'])

    // Retry KYC via direct service call (simulating Sumsub client)
    const mockClient = {
      createApplicant: async () => ({ applicantId }),
      getAccessToken: async () => ({
        token: 'mock-access-token',
        url: 'https://sumsub.com/verify/mock',
      }),
    }
    const retryResult = await retryKyc(user.id, mockClient as any)
    expect(retryResult.accessToken).toBe('mock-access-token')

    // User should be IN_REVIEW again
    const retryUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(retryUser.kycStatus).toBe('IN_REVIEW')
    expect(retryUser.kycRejectionReasons).toEqual([])

    // Now approve
    await handleKycApproved(user.id)
    const finalUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(finalUser.kycStatus).toBe('VERIFIED')
  })

  it('KYC gates transfer creation — unverified user cannot create transfer', async () => {
    const { user } = await registerTestUser({ kycStatus: 'PENDING' })
    const recipient = await createTestRecipient(user.id)

    await expect(
      createTransfer({
        userId: user.id,
        recipientId: recipient.id,
        corridorId,
        sendAmount: new Decimal(100),
        exchangeRate: new Decimal(1042.65),
        fee: new Decimal(5),
      })
    ).rejects.toThrow(KycNotVerifiedError)
  })

  it('KYC status can be queried', async () => {
    const { user } = await registerTestUser({ kycStatus: 'PENDING' })

    const status = await getKycStatus(user.id)
    expect(status.status).toBe('PENDING')
    expect(status.applicantId).toBeUndefined()

    // After approval
    await handleKycApproved(user.id)
    const approvedStatus = await getKycStatus(user.id)
    expect(approvedStatus.status).toBe('VERIFIED')
  })

  it('duplicate Sumsub webhook is skipped (idempotency)', async () => {
    const { user } = await registerTestUser({ kycStatus: 'PENDING' })
    const applicantId = `applicant-dup-${Date.now()}`
    await prisma.user.update({
      where: { id: user.id },
      data: { kycStatus: 'IN_REVIEW', kycProviderId: applicantId },
    })

    const webhookSecret = 'test-sumsub-secret'
    const originalEnv = process.env.SUMSUB_WEBHOOK_SECRET
    process.env.SUMSUB_WEBHOOK_SECRET = webhookSecret

    const rawBody = JSON.stringify({
      applicantId,
      type: 'applicantReviewed',
      reviewResult: { reviewAnswer: 'GREEN' },
    })
    const signature = hmacSha256(rawBody, webhookSecret)

    try {
      // First call: processes
      await handleSumsubWebhook(rawBody, signature)
      // Second call: should be skipped silently (P2002 on create)
      await handleSumsubWebhook(rawBody, signature)
    } finally {
      process.env.SUMSUB_WEBHOOK_SECRET = originalEnv
    }

    // Only one webhook event stored
    const events = await prisma.webhookEvent.findMany({
      where: { provider: 'sumsub' },
    })
    expect(events).toHaveLength(1)
  })
})
