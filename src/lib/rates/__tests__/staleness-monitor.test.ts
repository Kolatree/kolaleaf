import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { StalenessMonitor } from '../staleness-monitor'

// ─── Test data helpers ───────────────────────────────

let corridorId: string
let corridor2Id: string

async function getOrCreateCorridor(base: string, target: string): Promise<string> {
  const existing = await prisma.corridor.findUnique({
    where: { baseCurrency_targetCurrency: { baseCurrency: base, targetCurrency: target } },
  })
  if (existing) return existing.id

  const corridor = await prisma.corridor.create({
    data: {
      baseCurrency: base,
      targetCurrency: target,
      minAmount: new Decimal('10.00'),
      maxAmount: new Decimal('50000.00'),
    },
  })
  return corridor.id
}

async function createRate(cId: string, effectiveAt: Date) {
  return prisma.rate.create({
    data: {
      corridorId: cId,
      wholesaleRate: new Decimal('950.000000'),
      spread: new Decimal('0.007000'),
      customerRate: new Decimal('943.350000'),
      effectiveAt,
      adminOverride: false,
    },
  })
}

// ─── Setup / Teardown ────────────────────────────────

beforeEach(async () => {
  // Clean rates
  await prisma.rate.deleteMany({})

  corridorId = await getOrCreateCorridor('AUD', 'NGN')
  corridor2Id = await getOrCreateCorridor('AUD', 'GHS')
})

afterAll(async () => {
  await prisma.rate.deleteMany({})
  // Clean up test corridor only (keep AUD-NGN as it's shared)
  await prisma.corridor.deleteMany({ where: { baseCurrency: 'AUD', targetCurrency: 'GHS' } })
})

// ─── Tests ───────────────────────────────────────────

describe('StalenessMonitor', () => {
  describe('checkAllCorridorStaleness', () => {
    it('reports a fresh rate as not stale and not blocked', async () => {
      await createRate(corridorId, new Date())

      const monitor = new StalenessMonitor()
      const results = await monitor.checkAllCorridorStaleness()

      const audNgn = results.find((r) => r.corridorId === corridorId)
      expect(audNgn).toBeDefined()
      expect(audNgn!.stale).toBe(false)
      expect(audNgn!.blocked).toBe(false)
      expect(audNgn!.hoursStale).toBeLessThan(1)
    })

    it('reports a 13h old rate as stale but not blocked', async () => {
      const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000)
      await createRate(corridorId, thirteenHoursAgo)

      const monitor = new StalenessMonitor()
      const results = await monitor.checkAllCorridorStaleness()

      const audNgn = results.find((r) => r.corridorId === corridorId)
      expect(audNgn!.stale).toBe(true)
      expect(audNgn!.blocked).toBe(false)
      expect(audNgn!.hoursStale).toBeGreaterThanOrEqual(13)
    })

    it('reports a 25h old rate as stale AND blocked', async () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
      await createRate(corridorId, twentyFiveHoursAgo)

      const monitor = new StalenessMonitor()
      const results = await monitor.checkAllCorridorStaleness()

      const audNgn = results.find((r) => r.corridorId === corridorId)
      expect(audNgn!.stale).toBe(true)
      expect(audNgn!.blocked).toBe(true)
      expect(audNgn!.hoursStale).toBeGreaterThanOrEqual(25)
    })

    it('checks multiple corridors independently', async () => {
      // AUD-NGN: fresh rate
      await createRate(corridorId, new Date())

      // AUD-GHS: 25h old rate (stale + blocked)
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
      await createRate(corridor2Id, twentyFiveHoursAgo)

      const monitor = new StalenessMonitor()
      const results = await monitor.checkAllCorridorStaleness()

      const audNgn = results.find((r) => r.corridorId === corridorId)
      const audGhs = results.find((r) => r.corridorId === corridor2Id)

      expect(audNgn!.stale).toBe(false)
      expect(audNgn!.blocked).toBe(false)

      expect(audGhs!.stale).toBe(true)
      expect(audGhs!.blocked).toBe(true)
    })

    it('reports corridor with no rates as stale and blocked', async () => {
      const monitor = new StalenessMonitor()
      const results = await monitor.checkAllCorridorStaleness()

      const audNgn = results.find((r) => r.corridorId === corridorId)
      expect(audNgn!.stale).toBe(true)
      expect(audNgn!.blocked).toBe(true)
    })
  })

  describe('shouldBlockTransfers', () => {
    it('returns false when rate is fresh', async () => {
      await createRate(corridorId, new Date())

      const monitor = new StalenessMonitor()
      const blocked = await monitor.shouldBlockTransfers(corridorId)

      expect(blocked).toBe(false)
    })

    it('returns false when rate is 13h old (stale but not blocking)', async () => {
      const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000)
      await createRate(corridorId, thirteenHoursAgo)

      const monitor = new StalenessMonitor()
      const blocked = await monitor.shouldBlockTransfers(corridorId)

      expect(blocked).toBe(false)
    })

    it('returns true when rate is 25h old', async () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
      await createRate(corridorId, twentyFiveHoursAgo)

      const monitor = new StalenessMonitor()
      const blocked = await monitor.shouldBlockTransfers(corridorId)

      expect(blocked).toBe(true)
    })

    it('returns true when no rate exists for corridor', async () => {
      const monitor = new StalenessMonitor()
      const blocked = await monitor.shouldBlockTransfers(corridorId)

      expect(blocked).toBe(true)
    })
  })
})
