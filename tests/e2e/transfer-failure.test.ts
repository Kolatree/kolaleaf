import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  prisma,
  registerTestUser,
  createTestRecipient,
  createTestTransfer,
  getTestCorridorId,
  cleanupTestData,
} from './helpers'
import { transitionTransfer } from '../../src/lib/transfers/state-machine'
import { logAuthEvent } from '../../src/lib/auth/audit'

let corridorId: string
let userId: string
let recipientId: string

beforeAll(async () => {
  await cleanupTestData()
  corridorId = await getTestCorridorId()
  const { user } = await registerTestUser({ kycStatus: 'VERIFIED' })
  userId = user.id
  const recipient = await createTestRecipient(userId)
  recipientId = recipient.id
})

afterEach(async () => {
  await prisma.webhookEvent.deleteMany({})
  await prisma.transferEvent.deleteMany({})
  await prisma.transfer.deleteMany({})
})

afterAll(async () => {
  await cleanupTestData()
})

describe('Transfer Failure + Recovery E2E', () => {
  it('payout fail → 3 retries → NEEDS_MANUAL → admin refund', async () => {
    // Create a transfer at AUD_RECEIVED (payment already received)
    const transfer = await createTestTransfer(userId, recipientId, {
      status: 'AUD_RECEIVED',
      sendAmount: 300,
      payoutProvider: 'FLUTTERWAVE',
      payoutProviderRef: 'FLW-REF-001',
    })

    // ── Step 1: AUD_RECEIVED → PROCESSING_NGN ──
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'SYSTEM',
    })

    // ── Step 2: First failure ──
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_FAILED',
      actor: 'SYSTEM',
      metadata: { reason: 'Provider timeout' },
    })

    // ── Step 3: First retry (retryCount 0 → 1) ──
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_RETRY',
      actor: 'SYSTEM',
    })
    const retry1 = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'SYSTEM',
    })
    expect(retry1.retryCount).toBe(1)

    // ── Step 4: Second failure + retry (retryCount 1 → 2) ──
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_FAILED',
      actor: 'SYSTEM',
    })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_RETRY',
      actor: 'SYSTEM',
    })
    const retry2 = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'SYSTEM',
    })
    expect(retry2.retryCount).toBe(2)

    // ── Step 5: Third failure + retry (retryCount 2 → 3) ──
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_FAILED',
      actor: 'SYSTEM',
    })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_RETRY',
      actor: 'SYSTEM',
    })
    const retry3 = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'SYSTEM',
    })
    expect(retry3.retryCount).toBe(3)

    // ── Step 5b: Fourth failure — retryCount is now 3, SM forces NEEDS_MANUAL ──
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_FAILED',
      actor: 'SYSTEM',
    })
    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_RETRY',
      actor: 'SYSTEM',
    })

    // retryCount is 3 — state machine forces NEEDS_MANUAL
    const needsManual = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN', // requesting PROCESSING_NGN, but SM overrides
      actor: 'SYSTEM',
    })
    expect(needsManual.status).toBe('NEEDS_MANUAL')

    // ── Step 6: Admin refund ──
    const refunded = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'REFUNDED',
      actor: 'ADMIN',
      actorId: 'admin-e2e',
      metadata: { action: 'admin_refund' },
    })
    expect(refunded.status).toBe('REFUNDED')

    // Log the admin action (using the test user as actor for FK constraint)
    await logAuthEvent({
      userId,
      event: 'ADMIN_TRANSFER_REFUND',
      metadata: { transferId: transfer.id, adminId: userId },
    })

    // ── Verify complete audit trail ──
    const events = await prisma.transferEvent.findMany({
      where: { transferId: transfer.id },
      orderBy: { createdAt: 'asc' },
    })

    const transitions = events.map((e) => `${e.fromStatus} → ${e.toStatus}`)
    expect(transitions).toContain('CREATED → AUD_RECEIVED')      // initial
    expect(transitions).toContain('AUD_RECEIVED → PROCESSING_NGN')
    expect(transitions).toContain('PROCESSING_NGN → NGN_FAILED')
    expect(transitions).toContain('NGN_FAILED → NGN_RETRY')
    expect(transitions).toContain('NGN_RETRY → PROCESSING_NGN')
    expect(transitions).toContain('NGN_RETRY → NEEDS_MANUAL')    // forced by retry cap
    expect(transitions).toContain('NEEDS_MANUAL → REFUNDED')
  })

  it('NEEDS_MANUAL → admin retry → PROCESSING_NGN succeeds', async () => {
    const transfer = await createTestTransfer(userId, recipientId, {
      status: 'NEEDS_MANUAL',
      retryCount: 3,
    })

    // Admin manually retries
    const retried = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'ADMIN',
      actorId: 'admin-retry-01',
      metadata: { manualRetry: true },
    })
    expect(retried.status).toBe('PROCESSING_NGN')

    // Now it succeeds
    const ngnSent = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_SENT',
      actor: 'SYSTEM',
    })
    expect(ngnSent.status).toBe('NGN_SENT')

    const completed = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'COMPLETED',
      actor: 'SYSTEM',
    })
    expect(completed.status).toBe('COMPLETED')
    expect(completed.completedAt).not.toBeNull()
  })

  it('NGN_FAILED → NEEDS_MANUAL directly (skipping retry)', async () => {
    const transfer = await createTestTransfer(userId, recipientId, {
      status: 'PROCESSING_NGN',
    })

    await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NGN_FAILED',
      actor: 'SYSTEM',
      metadata: { reason: 'Invalid bank details' },
    })

    // Go directly to NEEDS_MANUAL (non-retryable error)
    const manual = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'NEEDS_MANUAL',
      actor: 'SYSTEM',
      metadata: { reason: 'Invalid bank details — not retryable' },
    })
    expect(manual.status).toBe('NEEDS_MANUAL')
  })

  it('FLOAT_INSUFFICIENT pauses and resumes correctly', async () => {
    const transfer = await createTestTransfer(userId, recipientId, {
      status: 'AUD_RECEIVED',
    })

    // Float insufficient
    const paused = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'FLOAT_INSUFFICIENT',
      actor: 'SYSTEM',
      metadata: { reason: 'NGN float below threshold' },
    })
    expect(paused.status).toBe('FLOAT_INSUFFICIENT')

    // Float restored → back to AUD_RECEIVED
    const resumed = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'AUD_RECEIVED',
      actor: 'SYSTEM',
      metadata: { reason: 'Float restored' },
    })
    expect(resumed.status).toBe('AUD_RECEIVED')

    // Continue processing
    const processing = await transitionTransfer({
      transferId: transfer.id,
      toStatus: 'PROCESSING_NGN',
      actor: 'SYSTEM',
    })
    expect(processing.status).toBe('PROCESSING_NGN')
  })
})
