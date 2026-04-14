import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { checkAndAlertStaleness } from '../staleness-alert'

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
  await prisma.rate.deleteMany({})
  // Clean compliance reports from prior runs
  await prisma.complianceReport.deleteMany({
    where: { details: { path: ['source'], equals: 'staleness_alert_worker' } },
  })

  corridorId = await getOrCreateCorridor('AUD', 'NGN')
  corridor2Id = await getOrCreateCorridor('AUD', 'GHS')
})

afterAll(async () => {
  await prisma.rate.deleteMany({})
  await prisma.complianceReport.deleteMany({
    where: { details: { path: ['source'], equals: 'staleness_alert_worker' } },
  })
  await prisma.corridor.deleteMany({ where: { baseCurrency: 'AUD', targetCurrency: 'GHS' } })
})

// ─── Tests ───────────────────────────────────────────

describe('checkAndAlertStaleness', () => {
  it('returns no alerts when all rates are fresh', async () => {
    await createRate(corridorId, new Date())
    await createRate(corridor2Id, new Date())

    const result = await checkAndAlertStaleness()

    expect(result.alerts).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
  })

  it('returns an alert for a 13h stale rate', async () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000)
    await createRate(corridorId, thirteenHoursAgo)
    await createRate(corridor2Id, new Date()) // Keep the other fresh

    const result = await checkAndAlertStaleness()

    expect(result.alerts.length).toBeGreaterThanOrEqual(1)
    const alert = result.alerts.find((a) => a.corridorId === corridorId)
    expect(alert).toBeDefined()
    expect(alert!.hoursStale).toBeGreaterThanOrEqual(13)
    // 13h is stale but not blocked
    expect(result.blocked).not.toContain(corridorId)
  })

  it('returns both alert and blocked for a 25h stale rate', async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await createRate(corridorId, twentyFiveHoursAgo)

    const result = await checkAndAlertStaleness()

    // Should appear in alerts (stale)
    const alert = result.alerts.find((a) => a.corridorId === corridorId)
    expect(alert).toBeDefined()

    // Should also appear in blocked list (>24h)
    expect(result.blocked).toContain(corridorId)
  })

  it('creates a compliance report for stale rates', async () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000)
    await createRate(corridorId, thirteenHoursAgo)

    await checkAndAlertStaleness()

    const report = await prisma.complianceReport.findFirst({
      where: {
        type: 'SUSPICIOUS',
        details: { path: ['source'], equals: 'staleness_alert_worker' },
      },
    })
    expect(report).not.toBeNull()
  })

  it('handles corridor with no rates (treated as blocked)', async () => {
    // corridorId has no rate (deleted in beforeEach)
    const result = await checkAndAlertStaleness()

    const alert = result.alerts.find((a) => a.corridorId === corridorId)
    expect(alert).toBeDefined()
    expect(result.blocked).toContain(corridorId)
  })
})
