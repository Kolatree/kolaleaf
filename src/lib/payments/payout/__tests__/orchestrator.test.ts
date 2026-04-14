import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { PayoutOrchestrator } from '../orchestrator'
import type { PayoutProvider, PayoutResult, PayoutStatusResult } from '../types'
import { PayoutError } from '../types'

// ─── In-memory mock providers ─────────────────────────────────

function createMockProvider(
  name: 'FLUTTERWAVE' | 'PAYSTACK',
  behavior: {
    initiate?: () => Promise<PayoutResult>
    status?: () => Promise<PayoutStatusResult>
  } = {},
): PayoutProvider {
  return {
    name,
    initiatePayout: behavior.initiate ?? (async () => ({
      providerRef: `${name}-ref-001`,
      status: 'pending',
    })),
    getPayoutStatus: behavior.status ?? (async () => ({
      status: 'success',
    })),
  }
}

// ─── Test helpers ────────────────────────────────────────────

let userId: string
let recipientId: string
let corridorId: string

async function createTestTransfer(overrides: Record<string, unknown> = {}) {
  return prisma.transfer.create({
    data: {
      userId,
      recipientId,
      corridorId,
      sendAmount: new Decimal('1000.00'),
      receiveAmount: new Decimal('500000.00'),
      exchangeRate: new Decimal('500.00'),
      fee: new Decimal('5.00'),
      status: 'AUD_RECEIVED',
      ...overrides,
    },
  })
}

// ─── Setup / Teardown ────────────────────────────────────────

beforeEach(async () => {
  // Clean up only our test data (scoped by name prefix)
  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: 'OrcTest' } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: 'OrcTest' } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: 'OrcTest' } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'OrcTest' } } })

  const user = await prisma.user.create({ data: { fullName: 'OrcTest User' } })
  userId = user.id

  const recipient = await prisma.recipient.create({
    data: {
      userId,
      fullName: 'OrcTest Recipient',
      bankName: 'Test Bank',
      bankCode: '044',
      accountNumber: '0690000031',
    },
  })
  recipientId = recipient.id

  // Reuse the seeded AUD-NGN corridor if it exists, otherwise create one
  const existing = await prisma.corridor.findUnique({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
  })
  if (existing) {
    corridorId = existing.id
  } else {
    const corridor = await prisma.corridor.create({
      data: {
        baseCurrency: 'AUD',
        targetCurrency: 'NGN',
        minAmount: new Decimal('10.00'),
        maxAmount: new Decimal('50000.00'),
      },
    })
    corridorId = corridor.id
  }
})

afterAll(async () => {
  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: 'OrcTest' } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: 'OrcTest' } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: 'OrcTest' } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'OrcTest' } } })
})

// ─── Tests ───────────────────────────────────────────────────

describe('PayoutOrchestrator', () => {
  describe('initiatePayout', () => {
    it('initiates payout from AUD_RECEIVED and transitions to PROCESSING_NGN', async () => {
      const transfer = await createTestTransfer()
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.initiatePayout(transfer.id)

      expect(updated.status).toBe('PROCESSING_NGN')
      expect(updated.payoutProvider).toBe('FLUTTERWAVE')
      expect(updated.payoutProviderRef).toBe('FLUTTERWAVE-ref-001')
    })

    it('initiates payout from FLOAT_INSUFFICIENT (restored) transfer', async () => {
      // A transfer that was paused due to low float, now restored back to AUD_RECEIVED
      const transfer = await createTestTransfer({ status: 'AUD_RECEIVED' })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.initiatePayout(transfer.id)
      expect(updated.status).toBe('PROCESSING_NGN')
    })

    it('rejects payout for non-AUD_RECEIVED transfer', async () => {
      const transfer = await createTestTransfer({ status: 'CREATED' })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      await expect(orc.initiatePayout(transfer.id)).rejects.toThrow()
    })

    it('sets payoutProvider reference on the transfer', async () => {
      const transfer = await createTestTransfer()
      const fw = createMockProvider('FLUTTERWAVE', {
        initiate: async () => ({ providerRef: 'FW-12345', status: 'NEW' }),
      })
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.initiatePayout(transfer.id)

      expect(updated.payoutProviderRef).toBe('FW-12345')
    })
  })

  describe('handlePayoutSuccess', () => {
    it('transitions from PROCESSING_NGN through NGN_SENT to COMPLETED', async () => {
      const transfer = await createTestTransfer({ status: 'PROCESSING_NGN', payoutProvider: 'FLUTTERWAVE' })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.handlePayoutSuccess(transfer.id)

      expect(updated.status).toBe('COMPLETED')
      expect(updated.completedAt).not.toBeNull()

      // Verify audit trail: should have NGN_SENT and COMPLETED events
      const events = await prisma.transferEvent.findMany({
        where: { transferId: transfer.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(events).toHaveLength(2)
      expect(events[0].toStatus).toBe('NGN_SENT')
      expect(events[1].toStatus).toBe('COMPLETED')
    })
  })

  describe('handlePayoutFailure', () => {
    it('transitions to NGN_FAILED then retries (retryCount < 3)', async () => {
      const transfer = await createTestTransfer({
        status: 'PROCESSING_NGN',
        payoutProvider: 'FLUTTERWAVE',
        retryCount: 0,
      })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.handlePayoutFailure(transfer.id, 'Bank timeout')

      expect(updated.status).toBe('PROCESSING_NGN')
      expect(updated.payoutProvider).toBe('FLUTTERWAVE')
      // retryCount should have been incremented in the NGN_RETRY -> PROCESSING_NGN transition
      expect(updated.retryCount).toBe(1)

      // Audit: NGN_FAILED, NGN_RETRY, PROCESSING_NGN
      const events = await prisma.transferEvent.findMany({
        where: { transferId: transfer.id },
        orderBy: { createdAt: 'asc' },
      })
      expect(events.length).toBeGreaterThanOrEqual(3)
    })

    it('fails over from Flutterwave to Paystack after 3 retries', async () => {
      const transfer = await createTestTransfer({
        status: 'PROCESSING_NGN',
        payoutProvider: 'FLUTTERWAVE',
        retryCount: 2, // This is the third attempt (0, 1, 2)
      })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK', {
        initiate: async () => ({ providerRef: 'PS-99999', status: 'pending' }),
      })
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.handlePayoutFailure(transfer.id, 'Repeated failure')

      expect(updated.payoutProvider).toBe('PAYSTACK')
      expect(updated.payoutProviderRef).toBe('PS-99999')
      expect(updated.retryCount).toBe(0) // Reset for new provider
      expect(updated.status).toBe('PROCESSING_NGN')
    })

    it('transitions to NEEDS_MANUAL when Paystack also exhausts retries', async () => {
      const transfer = await createTestTransfer({
        status: 'PROCESSING_NGN',
        payoutProvider: 'PAYSTACK',
        retryCount: 2, // Third attempt on Paystack
      })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.handlePayoutFailure(transfer.id, 'Final failure')

      expect(updated.status).toBe('NEEDS_MANUAL')
    })

    it('records failure reason in metadata', async () => {
      const transfer = await createTestTransfer({
        status: 'PROCESSING_NGN',
        payoutProvider: 'FLUTTERWAVE',
        retryCount: 0,
      })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      await orc.handlePayoutFailure(transfer.id, 'Connection refused')

      const event = await prisma.transferEvent.findFirst({
        where: { transferId: transfer.id, toStatus: 'NGN_FAILED' },
      })
      expect(event).not.toBeNull()
      expect((event!.metadata as { reason: string }).reason).toBe('Connection refused')
    })
  })

  describe('handleManualRetry', () => {
    it('allows admin to retry from NEEDS_MANUAL', async () => {
      const transfer = await createTestTransfer({
        status: 'NEEDS_MANUAL',
        payoutProvider: 'FLUTTERWAVE',
        retryCount: 3,
      })
      const fw = createMockProvider('FLUTTERWAVE', {
        initiate: async () => ({ providerRef: 'FW-MANUAL-1', status: 'NEW' }),
      })
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      const updated = await orc.handleManualRetry(transfer.id, 'admin_001')

      expect(updated.status).toBe('PROCESSING_NGN')
      expect(updated.retryCount).toBe(0) // Reset on manual retry
      expect(updated.payoutProviderRef).toBe('FW-MANUAL-1')

      // Verify admin actor in event
      const events = await prisma.transferEvent.findMany({
        where: { transferId: transfer.id },
        orderBy: { createdAt: 'asc' },
      })
      const adminEvent = events.find((e) => e.actorId === 'admin_001')
      expect(adminEvent).not.toBeNull()
      expect(adminEvent!.actor).toBe('ADMIN')
    })

    it('rejects manual retry from non-NEEDS_MANUAL state', async () => {
      const transfer = await createTestTransfer({ status: 'PROCESSING_NGN' })
      const fw = createMockProvider('FLUTTERWAVE')
      const ps = createMockProvider('PAYSTACK')
      const orc = new PayoutOrchestrator(fw, ps)

      await expect(orc.handleManualRetry(transfer.id, 'admin_001')).rejects.toThrow()
    })
  })
})
