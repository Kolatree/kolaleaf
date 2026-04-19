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
import {
  generatePayIdForTransfer,
  handlePaymentReceived,
} from '../../src/lib/payments/monoova/payid-service'
import { handleMonoovaWebhook } from '../../src/lib/payments/monoova/webhook'
import { StubMonoovaClient } from '../../src/lib/payments/monoova'
import Decimal from 'decimal.js'

let corridorId: string

beforeAll(async () => {
  // Stub-mode wallet balance used by the Float preflight in
  // handlePaymentReceived. Without this env var, the stubbed
  // FlutterwaveProvider reports 0 NGN balance, which trips
  // MIN_FLOAT_BALANCE_NGN (500000 default) and transitions every
  // lifecycle transfer straight to FLOAT_INSUFFICIENT. Setting a
  // generous stub balance keeps the e2e path green.
  process.env.FLOAT_BALANCE_NGN = '10000000'
  await cleanupTestData()
  corridorId = await getTestCorridorId()
})

afterEach(async () => {
  await cleanupTestData()
})

afterAll(async () => {
  await cleanupTestData()
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
    const awaitingTransfer = await generatePayIdForTransfer(
      transfer.id,
      new StubMonoovaClient(),
    )
    expect(awaitingTransfer.status).toBe('AWAITING_AUD')
    expect(awaitingTransfer.payidProviderRef).toBe('stub@payid.kolaleaf.dev')
    expect(awaitingTransfer.payidReference).toMatch(new RegExp(`^STUB-KL-${transfer.id}-`))

    // ── Step 6: Simulate PayID payment received (AUD_RECEIVED -> payout kickoff) ──
    const audReceived = await handlePaymentReceived(transfer.id, new Decimal(500))
    expect(audReceived.status).toBe('AUD_RECEIVED')

    const processingTransfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
    })
    expect(processingTransfer.status).toBe('PROCESSING_NGN')

    // ── Step 7: NGN_SENT ──
    const ngnSent = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_SENT',
      actor: 'SYSTEM',
    })
    expect(ngnSent.status).toBe('NGN_SENT')

    // ── Step 8: COMPLETED ──
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
      'NULL_STATE → CREATED',        // initial (Step 31 sentinel)
      'CREATED → AWAITING_AUD',
      'AWAITING_AUD → AUD_RECEIVED',
      'AUD_RECEIVED → PROCESSING_NGN',
      'PROCESSING_NGN → NGN_SENT',
      'NGN_SENT → COMPLETED',
    ])
  }, 15000)

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

    // Verify transfer moved straight into payout processing after AUD receipt.
    const updated = await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })
    expect(updated.status).toBe('PROCESSING_NGN')

    // Verify webhook event recorded
    const webhookEvent = await prisma.webhookEvent.findFirst({
      where: { provider: 'monoova', eventId: payload.eventId },
    })
    expect(webhookEvent).not.toBeNull()
    expect(webhookEvent!.processed).toBe(true)
  })

  it('login after registration returns session and user (with email pre-verified)', async () => {
    const email = `login-e2e-${Date.now()}@test.com`
    const password = 'TestLogin123!'

    // Register, then mark the email verified directly — this test exercises
    // the credential path, not the verify-then-login gate (which is covered
    // in src/lib/auth/__tests__/login.test.ts).
    const { user: regUser } = await registerUser({
      fullName: 'Login User',
      email,
      password,
    })
    await prisma.userIdentifier.updateMany({
      where: { userId: regUser.id, type: 'EMAIL' },
      data: { verified: true, verifiedAt: new Date() },
    })

    // Login
    const { user, session, requires2FA } = await loginUser({
      identifier: email,
      password,
    })
    expect(user).not.toBeNull()
    expect(user!.fullName).toBe('Login User')
    expect(session).toBeDefined()
    expect(session!.token).toHaveLength(64)
    expect(requires2FA).toBe(false)
  })
})
