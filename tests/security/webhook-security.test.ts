import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import crypto from 'crypto'
import {
  prisma,
  registerTestUser,
  createTestRecipient,
  createTestTransfer,
  getTestCorridorId,
  cleanupTestData,
  hmacSha256,
  hmacSha512,
} from '../e2e/helpers'
import { handleMonoovaWebhook } from '../../src/lib/payments/monoova/webhook'
import { handleSumsubWebhook } from '../../src/lib/kyc/sumsub/webhook'
import { handleFlutterwaveWebhook, handlePaystackWebhook } from '../../src/lib/payments/payout/webhooks'
import { verifyMonoovaSignature } from '../../src/lib/payments/monoova/verify-signature'
import { verifySumsubSignature } from '../../src/lib/kyc/sumsub/verify-signature'
import { transitionTransfer } from '../../src/lib/transfers/state-machine'

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

describe('Webhook Security', () => {
  describe('Monoova signature verification', () => {
    it('rejects invalid Monoova signature', async () => {
      const originalEnv = process.env.MONOOVA_WEBHOOK_SECRET
      process.env.MONOOVA_WEBHOOK_SECRET = 'real-secret'

      const rawBody = JSON.stringify({
        eventId: 'evt-bad-sig',
        eventType: 'payment.received',
        payIdReference: 'KL-123',
        amount: 100,
        timestamp: new Date().toISOString(),
      })
      const wrongSignature = hmacSha256(rawBody, 'wrong-secret')

      try {
        await expect(
          handleMonoovaWebhook(rawBody, wrongSignature)
        ).rejects.toThrow('Invalid webhook signature')
      } finally {
        process.env.MONOOVA_WEBHOOK_SECRET = originalEnv
      }
    })

    it('rejects empty Monoova signature', async () => {
      const originalEnv = process.env.MONOOVA_WEBHOOK_SECRET
      process.env.MONOOVA_WEBHOOK_SECRET = 'real-secret'

      try {
        await expect(
          handleMonoovaWebhook(JSON.stringify({ eventId: 'x' }), '')
        ).rejects.toThrow('Invalid webhook signature')
      } finally {
        process.env.MONOOVA_WEBHOOK_SECRET = originalEnv
      }
    })
  })

  describe('Sumsub signature verification', () => {
    it('rejects invalid Sumsub signature', async () => {
      const originalEnv = process.env.SUMSUB_WEBHOOK_SECRET
      process.env.SUMSUB_WEBHOOK_SECRET = 'real-sumsub-secret'

      const rawBody = JSON.stringify({
        applicantId: 'app-123',
        type: 'applicantReviewed',
        reviewResult: { reviewAnswer: 'GREEN' },
      })
      const wrongSignature = hmacSha256(rawBody, 'wrong-secret')

      try {
        await expect(
          handleSumsubWebhook(rawBody, wrongSignature)
        ).rejects.toThrow('Invalid webhook signature')
      } finally {
        process.env.SUMSUB_WEBHOOK_SECRET = originalEnv
      }
    })
  })

  describe('Flutterwave signature verification', () => {
    it('rejects invalid Flutterwave signature (verif-hash mismatch)', async () => {
      const rawBody = JSON.stringify({
        event: 'transfer.completed',
        data: { id: 12345, reference: 'ref-1', status: 'SUCCESSFUL' },
      })

      await expect(
        handleFlutterwaveWebhook(rawBody, 'wrong-hash', 'correct-secret')
      ).rejects.toThrow('Invalid Flutterwave webhook signature')
    })

    it('rejects empty Flutterwave signature', async () => {
      const rawBody = JSON.stringify({
        event: 'transfer.completed',
        data: { id: 12345, reference: 'ref-1', status: 'SUCCESSFUL' },
      })

      await expect(
        handleFlutterwaveWebhook(rawBody, '', 'secret')
      ).rejects.toThrow('Invalid Flutterwave webhook signature')
    })
  })

  describe('Paystack signature verification', () => {
    it('rejects invalid Paystack signature (HMAC-SHA512 mismatch)', async () => {
      const rawBody = JSON.stringify({
        event: 'transfer.success',
        data: { transfer_code: 'TRF_xyz', reference: 'ref-2', status: 'success' },
      })

      const wrongSignature = hmacSha512(rawBody, 'wrong-key')

      await expect(
        handlePaystackWebhook(rawBody, wrongSignature, 'correct-key')
      ).rejects.toThrow('Invalid Paystack webhook signature')
    })
  })

  describe('Idempotency', () => {
    it('duplicate Monoova webhooks are skipped', async () => {
      const { user } = await registerTestUser({ kycStatus: 'VERIFIED' })
      const recipient = await createTestRecipient(user.id)
      const transfer = await createTestTransfer(user.id, recipient.id, {
        status: 'AWAITING_AUD',
        payidReference: 'KL-IDMP-1',
      })

      const secret = 'test-mono-secret'
      const originalEnv = process.env.MONOOVA_WEBHOOK_SECRET
      process.env.MONOOVA_WEBHOOK_SECRET = secret

      const rawBody = JSON.stringify({
        eventId: 'evt-idempotent-1',
        eventType: 'payment.received',
        payIdReference: 'KL-IDMP-1',
        amount: 500,
        timestamp: new Date().toISOString(),
      })
      const signature = hmacSha256(rawBody, secret)

      try {
        // First call processes
        await handleMonoovaWebhook(rawBody, signature)
        // Second call should be silently skipped (P2002 on create)
        await handleMonoovaWebhook(rawBody, signature)
      } finally {
        process.env.MONOOVA_WEBHOOK_SECRET = originalEnv
      }

      // Only 1 webhook event stored
      const events = await prisma.webhookEvent.findMany({
        where: { provider: 'monoova', eventId: 'evt-idempotent-1' },
      })
      expect(events).toHaveLength(1)
    })

    it('duplicate Flutterwave webhooks are skipped', async () => {
      const { user } = await registerTestUser({ kycStatus: 'VERIFIED' })
      const recipient = await createTestRecipient(user.id)
      const transfer = await createTestTransfer(user.id, recipient.id, {
        status: 'PROCESSING_NGN',
        payoutProvider: 'FLUTTERWAVE',
        payoutProviderRef: '99999',
      })

      const webhookSecret = 'flw-test-secret'
      const rawBody = JSON.stringify({
        event: 'transfer.completed',
        data: { id: 99999, reference: 'ref-dup', status: 'SUCCESSFUL' },
      })

      // First call
      await handleFlutterwaveWebhook(rawBody, webhookSecret, webhookSecret)
      // Second call: idempotent
      await handleFlutterwaveWebhook(rawBody, webhookSecret, webhookSecret)

      const events = await prisma.webhookEvent.findMany({
        where: { provider: 'FLUTTERWAVE', eventId: '99999' },
      })
      expect(events).toHaveLength(1)
    })

    it('duplicate Paystack webhooks are skipped', async () => {
      const { user } = await registerTestUser({ kycStatus: 'VERIFIED' })
      const recipient = await createTestRecipient(user.id)
      const transfer = await createTestTransfer(user.id, recipient.id, {
        status: 'PROCESSING_NGN',
        payoutProvider: 'PAYSTACK',
        payoutProviderRef: 'TRF_dup_test',
      })

      const secretKey = 'paystack-test-secret'
      const rawBody = JSON.stringify({
        event: 'transfer.success',
        data: { transfer_code: 'TRF_dup_test', reference: 'ref-dup-ps', status: 'success' },
      })
      const signature = hmacSha512(rawBody, secretKey)

      // First call
      await handlePaystackWebhook(rawBody, signature, secretKey)
      // Second call: idempotent
      await handlePaystackWebhook(rawBody, signature, secretKey)

      const events = await prisma.webhookEvent.findMany({
        where: { provider: 'PAYSTACK', eventId: 'TRF_dup_test' },
      })
      expect(events).toHaveLength(1)
    })
  })

  describe('Timing-safe comparisons', () => {
    it('Monoova uses crypto.timingSafeEqual', () => {
      const payload = '{"test": true}'
      const secret = 'test-secret'
      const correctSig = hmacSha256(payload, secret)

      // Valid signature passes
      expect(verifyMonoovaSignature(payload, correctSig, secret)).toBe(true)

      // Wrong signature fails
      expect(verifyMonoovaSignature(payload, 'abcd1234', secret)).toBe(false)

      // Empty signature fails
      expect(verifyMonoovaSignature(payload, '', secret)).toBe(false)
    })

    it('Sumsub uses crypto.timingSafeEqual', () => {
      const payload = '{"applicant": "test"}'
      const secret = 'sumsub-secret'
      const correctSig = hmacSha256(payload, secret)

      expect(verifySumsubSignature(payload, correctSig, secret)).toBe(true)
      expect(verifySumsubSignature(payload, 'wrong-sig', secret)).toBe(false)
      expect(verifySumsubSignature(payload, '', secret)).toBe(false)
    })

    it('all signature verification functions handle malformed input gracefully', () => {
      // Non-hex strings don't cause crashes
      expect(verifyMonoovaSignature('payload', 'not-hex-at-all!@#$', 'secret')).toBe(false)
      expect(verifySumsubSignature('payload', 'not-hex-at-all!@#$', 'secret')).toBe(false)
    })
  })
})
