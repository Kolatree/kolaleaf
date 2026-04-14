import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { runDailyReconciliation } from '../reconciliation'

// ─── Test data helpers ───────────────────────────────

let userId: string
let recipientId: string
let corridorId: string

const TEST_PREFIX = 'ReconTest'

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
      status: 'CREATED',
      ...overrides,
    },
  })
}

// ─── Setup / Teardown ────────────────────────────────

beforeEach(async () => {
  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: TEST_PREFIX } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: TEST_PREFIX } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: TEST_PREFIX } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: TEST_PREFIX } } })

  const user = await prisma.user.create({ data: { fullName: `${TEST_PREFIX} User` } })
  userId = user.id

  const recipient = await prisma.recipient.create({
    data: {
      userId,
      fullName: `${TEST_PREFIX} Recipient`,
      bankName: 'Test Bank',
      bankCode: '044',
      accountNumber: '0690000031',
    },
  })
  recipientId = recipient.id

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
  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: TEST_PREFIX } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: TEST_PREFIX } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: TEST_PREFIX } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: TEST_PREFIX } } })
})

// ─── Tests ───────────────────────────────────────────

describe('runDailyReconciliation', () => {
  it('expires transfers stuck in AWAITING_AUD for >24h', async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)

    await createTestTransfer({
      status: 'AWAITING_AUD',
      createdAt: twentyFiveHoursAgo,
      updatedAt: twentyFiveHoursAgo,
    })

    const report = await runDailyReconciliation()

    expect(report.expired).toBe(1)
    expect(report.expiredIds).toHaveLength(1)

    // Verify the transfer was actually transitioned
    const transfer = await prisma.transfer.findFirst({
      where: { userId, status: 'EXPIRED' },
    })
    expect(transfer).not.toBeNull()
  })

  it('does NOT expire AWAITING_AUD transfers under 24h old', async () => {
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000)

    await createTestTransfer({
      status: 'AWAITING_AUD',
      createdAt: twentyThreeHoursAgo,
      updatedAt: twentyThreeHoursAgo,
    })

    const report = await runDailyReconciliation()

    expect(report.expired).toBe(0)

    const transfer = await prisma.transfer.findFirst({
      where: { userId, status: 'AWAITING_AUD' },
    })
    expect(transfer).not.toBeNull()
  })

  it('flags transfers stuck in PROCESSING_NGN for >1h', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)

    await createTestTransfer({
      status: 'PROCESSING_NGN',
      updatedAt: twoHoursAgo,
    })

    const report = await runDailyReconciliation()

    expect(report.flagged).toBe(1)
    expect(report.flaggedIds).toHaveLength(1)

    // Flagging creates a compliance report, does NOT change transfer status
    const complianceReport = await prisma.complianceReport.findFirst({
      where: {
        type: 'SUSPICIOUS',
        details: { path: ['reason'], equals: 'stuck_processing_ngn' },
      },
    })
    expect(complianceReport).not.toBeNull()
  })

  it('does NOT flag PROCESSING_NGN transfers under 1h old', async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

    await createTestTransfer({
      status: 'PROCESSING_NGN',
      updatedAt: thirtyMinutesAgo,
    })

    const report = await runDailyReconciliation()

    expect(report.flagged).toBe(0)
  })

  it('retries transfers stuck in NGN_RETRY for >30min', async () => {
    const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000)

    await createTestTransfer({
      status: 'NGN_RETRY',
      updatedAt: fortyFiveMinutesAgo,
      retryCount: 1,
    })

    const report = await runDailyReconciliation()

    expect(report.retried).toBe(1)
    expect(report.retriedIds).toHaveLength(1)

    // Verify the transfer was transitioned back to PROCESSING_NGN
    const transfer = await prisma.transfer.findFirst({
      where: { userId, status: 'PROCESSING_NGN' },
    })
    expect(transfer).not.toBeNull()
  })

  it('does NOT retry NGN_RETRY transfers under 30min old', async () => {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000)

    await createTestTransfer({
      status: 'NGN_RETRY',
      updatedAt: twentyMinutesAgo,
      retryCount: 1,
    })

    const report = await runDailyReconciliation()

    expect(report.retried).toBe(0)
  })

  it('returns empty report when no transfers need action', async () => {
    // Create a healthy transfer that shouldn't trigger anything
    await createTestTransfer({ status: 'COMPLETED' })

    const report = await runDailyReconciliation()

    expect(report.expired).toBe(0)
    expect(report.flagged).toBe(0)
    expect(report.retried).toBe(0)
    expect(report.expiredIds).toEqual([])
    expect(report.flaggedIds).toEqual([])
    expect(report.retriedIds).toEqual([])
  })

  it('handles multiple categories in a single run', async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000)

    await createTestTransfer({
      status: 'AWAITING_AUD',
      createdAt: twentyFiveHoursAgo,
      updatedAt: twentyFiveHoursAgo,
    })
    await createTestTransfer({
      status: 'PROCESSING_NGN',
      updatedAt: twoHoursAgo,
    })
    await createTestTransfer({
      status: 'NGN_RETRY',
      updatedAt: fortyFiveMinutesAgo,
      retryCount: 0,
    })

    const report = await runDailyReconciliation()

    expect(report.expired).toBe(1)
    expect(report.flagged).toBe(1)
    expect(report.retried).toBe(1)
  })
})
