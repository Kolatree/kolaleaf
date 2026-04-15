import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  prisma,
  registerTestUser,
  createTestRecipient,
  getTestCorridorId,
  getTestCorridor,
  cleanupTestData,
  hmacSha256,
} from './helpers'
import { registerUser } from '../../src/lib/auth/register'
import { loginUser } from '../../src/lib/auth/login'
import { handleKycApproved } from '../../src/lib/kyc/sumsub/kyc-service'
import { createTransfer } from '../../src/lib/transfers/create'
import { transitionTransfer } from '../../src/lib/transfers/state-machine'
import { handlePaymentReceived } from '../../src/lib/payments/monoova/payid-service'
import { handleMonoovaWebhook } from '../../src/lib/payments/monoova/webhook'
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

describe('Transfer Lifecycle E2E — Golden Path', () => {
  it('register → KYC → add recipient → create transfer → PayID payment → payout success → COMPLETED', async () => {
    // ── Step 1: Register a user ──
    const { user, session } = await registerUser({
      fullName: 'Jane Remitter',
      email: `jane-${Date.now()}@test.com`,
      password: 'SecurePass123!',
    })
    expect(user.id).toBeDefined()
    expect(session.token).toHaveLength(64)

    // Verify auth event was created
    const registerEvent = await prisma.authEvent.findFirst({
      where: { userId: user.id, event: 'REGISTER' },
    })
    expect(registerEvent).not.toBeNull()

    // ── Step 2: Complete KYC (simulate Sumsub approved) ──
    expect(user.kycStatus).toBe('PENDING')
    await handleKycApproved(user.id)
    const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(verifiedUser.kycStatus).toBe('VERIFIED')

    // ── Step 3: Add recipient ──
    const recipient = await prisma.recipient.create({
      data: {
        userId: user.id,
        fullName: 'Chidi Okafor',
        bankName: 'GTBank',
        bankCode: '058',
        accountNumber: '0123456789',
      },
    })
    expect(recipient.userId).toBe(user.id)

    // ── Step 4: Create transfer ──
    const corridor = await getTestCorridor()
    const rate = await prisma.rate.create({
      data: {
        corridorId,
        wholesaleRate: 1050,
        spread: 0.007,
        customerRate: 1042.65,
        effectiveAt: new Date(),
      },
    })

    const transfer = await createTransfer({
      userId: user.id,
      recipientId: recipient.id,
      corridorId,
      sendAmount: new Decimal(500),
      exchangeRate: new Decimal(rate.customerRate.toString()),
      fee: new Decimal(5),
    })
    expect(transfer.status).toBe('CREATED')
    expect(transfer.sendAmount.toString()).toBe('500')

    // Verify initial TransferEvent
    const initialEvent = await prisma.transferEvent.findFirst({
      where: { transferId: transfer.id, toStatus: 'CREATED' },
    })
    expect(initialEvent).not.toBeNull()

    // ── Step 5: Transition CREATED → AWAITING_AUD (PayID generated) ──
    const payidRef = `KL-${transfer.id}-${Date.now()}`
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: { payidReference: payidRef },
    })
    const awaitingTransfer = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'AWAITING_AUD',
      actor: 'SYSTEM',
      metadata: { payidReference: payidRef },
    })
    expect(awaitingTransfer.status).toBe('AWAITING_AUD')

    // ── Step 6: Simulate PayID payment received (AUD_RECEIVED) ──
    const audReceived = await handlePaymentReceived(transfer.id, new Decimal(500))
    expect(audReceived.status).toBe('AUD_RECEIVED')

    // ── Step 7: PROCESSING_NGN ──
    const processingTransfer = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'SYSTEM',
    })
    expect(processingTransfer.status).toBe('PROCESSING_NGN')

    // ── Step 8: NGN_SENT ──
    const ngnSent = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_SENT',
      actor: 'SYSTEM',
    })
    expect(ngnSent.status).toBe('NGN_SENT')

    // ── Step 9: COMPLETED ──
    const completed = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'COMPLETED',
      actor: 'SYSTEM',
    })
    expect(completed.status).toBe('COMPLETED')
    expect(completed.completedAt).not.toBeNull()

    // ── Verify full audit trail ──
    const events = await prisma.transferEvent.findMany({
      where: { transferId: transfer.id },
      orderBy: { createdAt: 'asc' },
    })

    const statusFlow = events.map((e) => `${e.fromStatus} → ${e.toStatus}`)
    expect(statusFlow).toEqual([
      'CREATED → CREATED',           // initial
      'CREATED → AWAITING_AUD',
      'AWAITING_AUD → AUD_RECEIVED',
      'AUD_RECEIVED → PROCESSING_NGN',
      'PROCESSING_NGN → NGN_SENT',
      'NGN_SENT → COMPLETED',
    ])
  })

  it('walks the full state machine via Monoova webhook for AUD receipt', async () => {
    // Setup: verified user + recipient + transfer in AWAITING_AUD
    const { user } = await registerTestUser({ kycStatus: 'VERIFIED' })
    const recipient = await createTestRecipient(user.id)

    const transfer = await createTransfer({
      userId: user.id,
      recipientId: recipient.id,
      corridorId,
      sendAmount: new Decimal(200),
      exchangeRate: new Decimal(1042.65),
      fee: new Decimal(5),
    })

    const payidRef = `KL-MONO-${transfer.id}`
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: { payidReference: payidRef },
    })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'AWAITING_AUD',
      actor: 'SYSTEM',
    })

    // Simulate Monoova webhook
    const webhookSecret = 'test-monoova-secret'
    const originalEnv = process.env.MONOOVA_WEBHOOK_SECRET
    process.env.MONOOVA_WEBHOOK_SECRET = webhookSecret

    const payload = {
      eventId: `evt-${Date.now()}`,
      eventType: 'payment.received',
      payIdReference: payidRef,
      amount: 200,
      timestamp: new Date().toISOString(),
    }
    const rawBody = JSON.stringify(payload)
    const signature = hmacSha256(rawBody, webhookSecret)

    try {
      await handleMonoovaWebhook(rawBody, signature)
    } finally {
      process.env.MONOOVA_WEBHOOK_SECRET = originalEnv
    }

    // Verify transfer is now AUD_RECEIVED
    const updated = await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })
    expect(updated.status).toBe('AUD_RECEIVED')

    // Verify webhook event recorded
    const webhookEvent = await prisma.webhookEvent.findFirst({
      where: { provider: 'monoova', eventId: payload.eventId },
    })
    expect(webhookEvent).not.toBeNull()
    expect(webhookEvent!.processed).toBe(true)
  })

  it('login after registration returns session and user', async () => {
    const email = `login-e2e-${Date.now()}@test.com`
    const password = 'TestLogin123!'

    // Register
    await registerUser({
      fullName: 'Login User',
      email,
      password,
    })

    // Login
    const { user, session, requires2FA } = await loginUser({
      identifier: email,
      password,
    })
    expect(user).not.toBeNull()
    expect(user!.fullName).toBe('Login User')
    expect(session.token).toHaveLength(64)
    expect(requires2FA).toBe(false)
  })
})
