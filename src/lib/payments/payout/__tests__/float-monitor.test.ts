import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { FloatMonitor } from '../float-monitor'

// Mock Flutterwave wallet balance check
const mockGetWalletBalance = vi.fn()
const mockFlutterwaveProvider = {
  name: 'FLUTTERWAVE' as const,
  initiatePayout: vi.fn(),
  getPayoutStatus: vi.fn(),
  getWalletBalance: mockGetWalletBalance,
}

// ─── Test data helpers ────────────────────────────────

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

// ─── Setup / Teardown ────────────────────────────────

beforeEach(async () => {
  mockGetWalletBalance.mockReset()

  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: 'FloatTest' } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: 'FloatTest' } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: 'FloatTest' } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'FloatTest' } } })

  const user = await prisma.user.create({ data: { fullName: 'FloatTest User' } })
  userId = user.id

  const recipient = await prisma.recipient.create({
    data: {
      userId,
      fullName: 'FloatTest Recipient',
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
  await prisma.transferEvent.deleteMany({ where: { transfer: { user: { fullName: { startsWith: 'FloatTest' } } } } })
  await prisma.transfer.deleteMany({ where: { user: { fullName: { startsWith: 'FloatTest' } } } })
  await prisma.recipient.deleteMany({ where: { user: { fullName: { startsWith: 'FloatTest' } } } })
  await prisma.user.deleteMany({ where: { fullName: { startsWith: 'FloatTest' } } })
})

// ─── Tests ───────────────────────────────────────────

describe('FloatMonitor', () => {
  describe('checkFloatBalance', () => {
    it('returns balance and sufficient=true when above threshold', async () => {
      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('1500000.00'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const result = await monitor.checkFloatBalance()

      expect(result.provider).toBe('FLUTTERWAVE')
      expect(result.balance.toString()).toBe('1500000')
      expect(result.sufficient).toBe(true)
    })

    it('returns sufficient=false when below threshold', async () => {
      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('300000.00'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const result = await monitor.checkFloatBalance()

      expect(result.sufficient).toBe(false)
    })

    it('returns sufficient=true when exactly at threshold', async () => {
      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('500000'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const result = await monitor.checkFloatBalance()

      expect(result.sufficient).toBe(true)
    })
  })

  describe('pauseTransfersIfLowFloat', () => {
    it('pauses AUD_RECEIVED transfers when float is low', async () => {
      await createTestTransfer({ status: 'AUD_RECEIVED' })
      await createTestTransfer({ status: 'AUD_RECEIVED' })
      await createTestTransfer({ status: 'PROCESSING_NGN' }) // Should NOT be paused

      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('100000'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const count = await monitor.pauseTransfersIfLowFloat()

      expect(count).toBe(2)

      const paused = await prisma.transfer.count({
        where: { status: 'FLOAT_INSUFFICIENT' },
      })
      expect(paused).toBe(2)

      // Verify audit events were created
      const events = await prisma.transferEvent.findMany({
        where: { toStatus: 'FLOAT_INSUFFICIENT' },
      })
      expect(events).toHaveLength(2)
    })

    it('does not pause when float is sufficient', async () => {
      await createTestTransfer({ status: 'AUD_RECEIVED' })

      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('1000000'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const count = await monitor.pauseTransfersIfLowFloat()

      expect(count).toBe(0)
    })

    it('returns 0 when no AUD_RECEIVED transfers exist', async () => {
      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('100000'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const count = await monitor.pauseTransfersIfLowFloat()

      expect(count).toBe(0)
    })
  })

  describe('resumeTransfersIfFloatRestored', () => {
    it('resumes FLOAT_INSUFFICIENT transfers when float is restored', async () => {
      await createTestTransfer({ status: 'FLOAT_INSUFFICIENT' })
      await createTestTransfer({ status: 'FLOAT_INSUFFICIENT' })
      await createTestTransfer({ status: 'PROCESSING_NGN' }) // Should NOT be touched

      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('1000000'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const count = await monitor.resumeTransfersIfFloatRestored()

      expect(count).toBe(2)

      const restored = await prisma.transfer.count({
        where: { status: 'AUD_RECEIVED' },
      })
      expect(restored).toBe(2)
    })

    it('does not resume when float is still low', async () => {
      await createTestTransfer({ status: 'FLOAT_INSUFFICIENT' })

      mockGetWalletBalance.mockResolvedValueOnce(new Decimal('100000'))
      const monitor = new FloatMonitor(mockFlutterwaveProvider, new Decimal('500000'))

      const count = await monitor.resumeTransfersIfFloatRestored()

      expect(count).toBe(0)
    })
  })
})
