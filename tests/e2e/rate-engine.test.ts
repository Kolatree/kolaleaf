import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import {
  prisma,
  getTestCorridorId,
  cleanupTestData,
} from './helpers'
import { RateService } from '../../src/lib/rates/rate-service'
import { calculateCustomerRate } from '../../src/lib/rates/spread'
import Decimal from 'decimal.js'

let corridorId: string

const mockFxProvider = {
  name: 'test-provider',
  fetchWholesaleRate: vi.fn().mockResolvedValue(new Decimal(1050)),
}

beforeAll(async () => {
  await cleanupTestData()
  corridorId = await getTestCorridorId()
})

afterEach(async () => {
  await prisma.rate.deleteMany({})
  vi.restoreAllMocks()
})

afterAll(async () => {
  await cleanupTestData()
})

describe('Rate Engine E2E', () => {
  it('refreshRate → customer rate calculated with spread', async () => {
    const service = new RateService(mockFxProvider as any)
    const spread = new Decimal('0.007') // 0.7%

    const rate = await service.refreshRate(corridorId, spread)

    expect(rate.corridorId).toBe(corridorId)
    expect(rate.wholesaleRate.toString()).toBe('1050')
    expect(rate.spread.toString()).toBe('0.007')

    // customerRate = 1050 * (1 - 0.007) = 1050 * 0.993 = 1042.65
    const expectedCustomerRate = calculateCustomerRate(new Decimal(1050), spread)
    expect(rate.customerRate.toString()).toBe(expectedCustomerRate.toString())
    expect(rate.adminOverride).toBe(false)

    // Rate should be retrievable
    const current = await service.getCurrentRate(corridorId)
    expect(current).not.toBeNull()
    expect(current!.id).toBe(rate.id)
  })

  it('admin override rate is used instead of calculated rate', async () => {
    const service = new RateService(mockFxProvider as any)

    // First, create a regular rate
    await service.refreshRate(corridorId, new Decimal('0.007'))

    // Admin overrides
    const overrideRate = await service.setAdminRate({
      corridorId,
      customerRate: new Decimal(1040),
      wholesaleRate: new Decimal(1050),
      adminId: 'admin-rate-01',
    })

    expect(overrideRate.adminOverride).toBe(true)
    expect(overrideRate.customerRate.toString()).toBe('1040')
    expect(overrideRate.setById).toBe('admin-rate-01')

    // Most recent rate should be the admin override
    const current = await service.getCurrentRate(corridorId)
    expect(current!.id).toBe(overrideRate.id)
    expect(current!.adminOverride).toBe(true)
  })

  it('stale rate detected when rate is older than 12 hours', async () => {
    const service = new RateService(mockFxProvider as any)

    // Create a rate 13 hours ago
    await prisma.rate.create({
      data: {
        corridorId,
        wholesaleRate: 1050,
        spread: 0.007,
        customerRate: 1042.65,
        effectiveAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
      },
    })

    const result = await service.isRateStale(corridorId)
    expect(result.stale).toBe(true)
    expect(result.hoursStale).toBeGreaterThanOrEqual(13)
  })

  it('fresh rate is not stale', async () => {
    const service = new RateService(mockFxProvider as any)

    // Create a fresh rate (just now)
    await service.refreshRate(corridorId, new Decimal('0.007'))

    const result = await service.isRateStale(corridorId)
    expect(result.stale).toBe(false)
  })

  it('no rate exists → stale', async () => {
    const service = new RateService(mockFxProvider as any)

    const result = await service.isRateStale(corridorId)
    expect(result.stale).toBe(true)
  })

  it('rate history returns rates in descending order', async () => {
    const service = new RateService(mockFxProvider as any)

    // Create 3 rates at different times
    for (let i = 0; i < 3; i++) {
      await prisma.rate.create({
        data: {
          corridorId,
          wholesaleRate: 1050 + i,
          spread: 0.007,
          customerRate: (1050 + i) * 0.993,
          effectiveAt: new Date(Date.now() - (2 - i) * 60 * 60 * 1000),
        },
      })
    }

    const history = await service.getRateHistory(corridorId, 10)
    expect(history).toHaveLength(3)
    // Most recent first
    expect(Number(history[0].wholesaleRate)).toBeGreaterThan(Number(history[1].wholesaleRate))
    expect(Number(history[1].wholesaleRate)).toBeGreaterThan(Number(history[2].wholesaleRate))
  })

  it('spread calculation is mathematically correct', () => {
    const wholesale = new Decimal(1050)

    // 0.7% spread
    const rate1 = calculateCustomerRate(wholesale, new Decimal('0.007'))
    expect(rate1.toFixed(2)).toBe('1042.65')

    // 1% spread
    const rate2 = calculateCustomerRate(wholesale, new Decimal('0.01'))
    expect(rate2.toFixed(2)).toBe('1039.50')

    // 0% spread (no margin)
    const rate3 = calculateCustomerRate(wholesale, new Decimal('0'))
    expect(rate3.toFixed(2)).toBe('1050.00')
  })
})
