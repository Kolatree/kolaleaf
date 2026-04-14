import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { RateService } from '../rate-service'
import type { FxRateProvider } from '../fx-fetcher'

// ─── Mock FX provider ────────────────────────────────

const mockFetchWholesaleRate = vi.fn()
const mockProvider: FxRateProvider = {
  name: 'mock-fx',
  fetchWholesaleRate: mockFetchWholesaleRate,
}

// ─── Test data helpers ───────────────────────────────

let corridorId: string
const TEST_PREFIX = 'RateSvcTest'

async function seedCorridor() {
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
}

async function createRate(overrides: Record<string, unknown> = {}) {
  return prisma.rate.create({
    data: {
      corridorId,
      wholesaleRate: new Decimal('950.000000'),
      spread: new Decimal('0.007000'),
      customerRate: new Decimal('943.350000'),
      effectiveAt: new Date(),
      adminOverride: false,
      ...overrides,
    },
  })
}

// ─── Setup / Teardown ────────────────────────────────

beforeEach(async () => {
  mockFetchWholesaleRate.mockReset()

  // Clean up rates for the corridor
  await prisma.rate.deleteMany({ where: { corridor: { baseCurrency: 'AUD', targetCurrency: 'NGN' } } })
  await seedCorridor()
})

afterAll(async () => {
  await prisma.rate.deleteMany({ where: { corridor: { baseCurrency: 'AUD', targetCurrency: 'NGN' } } })
})

// ─── Tests ───────────────────────────────────────────

describe('RateService', () => {
  describe('getCurrentRate', () => {
    it('returns the most recent rate for a corridor', async () => {
      const oldRate = await createRate({
        effectiveAt: new Date(Date.now() - 60_000),
        customerRate: new Decimal('940.000000'),
      })
      const newRate = await createRate({
        effectiveAt: new Date(),
        customerRate: new Decimal('943.350000'),
      })

      const service = new RateService(mockProvider)
      const result = await service.getCurrentRate(corridorId)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(newRate.id)
      expect(result!.customerRate.toString()).toBe('943.35')
    })

    it('returns null when no rates exist for the corridor', async () => {
      const service = new RateService(mockProvider)
      const result = await service.getCurrentRate(corridorId)

      expect(result).toBeNull()
    })
  })

  describe('refreshRate', () => {
    it('fetches wholesale rate from FX API and stores a new rate record', async () => {
      mockFetchWholesaleRate.mockResolvedValueOnce(new Decimal('955.500000'))

      // Set spread on the corridor — the service reads it from the corridor config
      // For this test we pass the spread explicitly
      const service = new RateService(mockProvider)
      const result = await service.refreshRate(corridorId, new Decimal('0.007000'))

      expect(mockFetchWholesaleRate).toHaveBeenCalledWith('AUD', 'NGN')
      expect(result.wholesaleRate.toString()).toBe('955.5')
      expect(result.adminOverride).toBe(false)
      expect(result.provider).toBe('mock-fx')

      // Customer rate = 955.5 * (1 - 0.007) = 955.5 * 0.993 = 948.8115
      expect(result.customerRate.toNumber()).toBeCloseTo(948.8115, 4)
      expect(result.spread.toString()).toBe('0.007')

      // Verify it was persisted
      const fromDb = await prisma.rate.findUnique({ where: { id: result.id } })
      expect(fromDb).not.toBeNull()
    })
  })

  describe('setAdminRate', () => {
    it('creates a rate with adminOverride: true', async () => {
      // Provide a wholesale reference so we can compute implied spread
      mockFetchWholesaleRate.mockResolvedValueOnce(new Decimal('950.000000'))

      const service = new RateService(mockProvider)
      const result = await service.setAdminRate({
        corridorId,
        customerRate: new Decimal('940.000000'),
        wholesaleRate: new Decimal('950.000000'),
        adminId: 'admin_001',
      })

      expect(result.adminOverride).toBe(true)
      expect(result.customerRate.toString()).toBe('940')
      expect(result.setById).toBe('admin_001')

      // Implied spread = 1 - (940 / 950) = 1 - 0.989473... ≈ 0.010526
      expect(result.spread.toNumber()).toBeCloseTo(0.010526, 5)
    })

    it('stores the admin rate in the database', async () => {
      const service = new RateService(mockProvider)
      const result = await service.setAdminRate({
        corridorId,
        customerRate: new Decimal('935.000000'),
        wholesaleRate: new Decimal('950.000000'),
        adminId: 'admin_002',
      })

      const fromDb = await prisma.rate.findUnique({ where: { id: result.id } })
      expect(fromDb).not.toBeNull()
      expect(fromDb!.adminOverride).toBe(true)
      expect(fromDb!.setById).toBe('admin_002')
    })
  })

  describe('isRateStale', () => {
    it('returns stale: false when rate is fresh', async () => {
      await createRate({ effectiveAt: new Date() })

      const service = new RateService(mockProvider)
      const result = await service.isRateStale(corridorId)

      expect(result.stale).toBe(false)
      expect(result.staleSince).toBeUndefined()
      expect(result.hoursStale).toBeUndefined()
    })

    it('returns stale: true when rate is older than 12 hours', async () => {
      const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000)
      await createRate({ effectiveAt: thirteenHoursAgo })

      const service = new RateService(mockProvider)
      const result = await service.isRateStale(corridorId)

      expect(result.stale).toBe(true)
      expect(result.staleSince).toEqual(thirteenHoursAgo)
      expect(result.hoursStale).toBeGreaterThanOrEqual(13)
    })

    it('returns stale: false when rate is just under 12 hours old', async () => {
      // Use 11h59m to avoid race with test execution time
      const justUnderTwelveHours = new Date(Date.now() - (11 * 60 + 59) * 60 * 1000)
      await createRate({ effectiveAt: justUnderTwelveHours })

      const service = new RateService(mockProvider)
      const result = await service.isRateStale(corridorId)

      expect(result.stale).toBe(false)
    })

    it('returns stale: true with no rates (treated as infinitely stale)', async () => {
      const service = new RateService(mockProvider)
      const result = await service.isRateStale(corridorId)

      expect(result.stale).toBe(true)
    })
  })

  describe('getRateHistory', () => {
    it('returns rates ordered by effectiveAt descending', async () => {
      const rate1 = await createRate({ effectiveAt: new Date(Date.now() - 120_000), customerRate: new Decimal('940.000000') })
      const rate2 = await createRate({ effectiveAt: new Date(Date.now() - 60_000), customerRate: new Decimal('942.000000') })
      const rate3 = await createRate({ effectiveAt: new Date(), customerRate: new Decimal('943.350000') })

      const service = new RateService(mockProvider)
      const history = await service.getRateHistory(corridorId)

      expect(history).toHaveLength(3)
      expect(history[0].id).toBe(rate3.id)
      expect(history[1].id).toBe(rate2.id)
      expect(history[2].id).toBe(rate1.id)
    })

    it('respects the limit parameter', async () => {
      await createRate({ effectiveAt: new Date(Date.now() - 120_000) })
      await createRate({ effectiveAt: new Date(Date.now() - 60_000) })
      await createRate({ effectiveAt: new Date() })

      const service = new RateService(mockProvider)
      const history = await service.getRateHistory(corridorId, 2)

      expect(history).toHaveLength(2)
    })

    it('returns empty array when no rates exist', async () => {
      const service = new RateService(mockProvider)
      const history = await service.getRateHistory(corridorId)

      expect(history).toEqual([])
    })
  })
})
