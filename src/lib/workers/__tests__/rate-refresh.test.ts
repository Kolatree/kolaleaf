import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { refreshAllCorridorRates } from '../rate-refresh'

// ─── Mock the RateService ───────────────────────────

const mockRefreshRate = vi.fn()

vi.mock('@/lib/rates/rate-service', () => {
  return {
    RateService: class {
      refreshRate = mockRefreshRate
    },
  }
})

vi.mock('@/lib/rates/fx-fetcher', () => {
  return {
    DefaultFxRateProvider: class {},
  }
})

// ─── Test data helpers ───────────────────────────────

let corridorId: string
let corridor2Id: string
let inactiveCorridorId: string

async function getOrCreateCorridor(base: string, target: string, active = true): Promise<string> {
  const existing = await prisma.corridor.findUnique({
    where: { baseCurrency_targetCurrency: { baseCurrency: base, targetCurrency: target } },
  })
  if (existing) {
    // Ensure the active state matches what we need
    if (existing.active !== active) {
      await prisma.corridor.update({ where: { id: existing.id }, data: { active } })
    }
    return existing.id
  }

  const corridor = await prisma.corridor.create({
    data: {
      baseCurrency: base,
      targetCurrency: target,
      minAmount: new Decimal('10.00'),
      maxAmount: new Decimal('50000.00'),
      active,
    },
  })
  return corridor.id
}

// ─── Setup / Teardown ────────────────────────────────

beforeEach(async () => {
  mockRefreshRate.mockReset()

  corridorId = await getOrCreateCorridor('AUD', 'NGN', true)
  corridor2Id = await getOrCreateCorridor('AUD', 'GHS', true)
  inactiveCorridorId = await getOrCreateCorridor('AUD', 'KES', false)
})

afterAll(async () => {
  // Clean up test-only corridors, keep AUD-NGN
  await prisma.rate.deleteMany({ where: { corridor: { baseCurrency: 'AUD', targetCurrency: 'GHS' } } })
  await prisma.rate.deleteMany({ where: { corridor: { baseCurrency: 'AUD', targetCurrency: 'KES' } } })
  await prisma.corridor.deleteMany({ where: { baseCurrency: 'AUD', targetCurrency: 'GHS' } })
  await prisma.corridor.deleteMany({ where: { baseCurrency: 'AUD', targetCurrency: 'KES' } })
})

// ─── Tests ───────────────────────────────────────────

describe('refreshAllCorridorRates', () => {
  it('refreshes rates for all active corridors', async () => {
    mockRefreshRate.mockResolvedValue({
      id: 'rate_1',
      customerRate: new Decimal('943.35'),
    })

    const results = await refreshAllCorridorRates()

    // Should have called refreshRate for each active corridor
    const activeResults = results.filter((r) => r.success)
    expect(activeResults.length).toBeGreaterThanOrEqual(2)

    // Should NOT include the inactive corridor
    const inactiveResult = results.find((r) => r.corridorId === inactiveCorridorId)
    expect(inactiveResult).toBeUndefined()
  })

  it('skips inactive corridors', async () => {
    mockRefreshRate.mockResolvedValue({
      id: 'rate_1',
      customerRate: new Decimal('943.35'),
    })

    const results = await refreshAllCorridorRates()

    const corridorIds = results.map((r) => r.corridorId)
    expect(corridorIds).not.toContain(inactiveCorridorId)
  })

  it('handles API failure for one corridor without blocking others', async () => {
    let callCount = 0
    mockRefreshRate.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        throw new Error('FX API timeout')
      }
      return { id: 'rate_2', customerRate: new Decimal('943.35') }
    })

    const results = await refreshAllCorridorRates()

    const failed = results.filter((r) => !r.success)
    const succeeded = results.filter((r) => r.success)

    expect(failed.length).toBeGreaterThanOrEqual(1)
    expect(succeeded.length).toBeGreaterThanOrEqual(1)

    // Failed result should have an error message
    expect(failed[0].error).toBeDefined()
  })

  it('returns rate value on success', async () => {
    mockRefreshRate.mockResolvedValue({
      id: 'rate_1',
      customerRate: new Decimal('943.35'),
    })

    const results = await refreshAllCorridorRates()

    const successful = results.find((r) => r.success)
    expect(successful).toBeDefined()
    expect(successful!.rate).toBeDefined()
  })
})
