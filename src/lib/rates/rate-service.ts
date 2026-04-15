import Decimal from 'decimal.js'
import { prisma } from '../db/client'
import type { FxRateProvider } from './fx-fetcher'
import { calculateCustomerRate } from './spread'
import { DefaultFxRateProvider } from './fx-fetcher'
import type { Rate, Corridor } from '../../generated/prisma/client'

const STALE_THRESHOLD_HOURS = 12

export class RateService {
  private readonly fxProvider: FxRateProvider

  constructor(fxProvider: FxRateProvider) {
    this.fxProvider = fxProvider
  }

  /** Returns the most recent rate for a corridor, or null if none exist. */
  async getCurrentRate(corridorId: string): Promise<Rate | null> {
    return prisma.rate.findFirst({
      where: { corridorId },
      orderBy: { effectiveAt: 'desc' },
    })
  }

  /** Fetches a new wholesale rate from the FX API, applies spread, and stores a new Rate record. */
  async refreshRate(corridorId: string, spread: Decimal): Promise<Rate> {
    const corridor = await prisma.corridor.findUniqueOrThrow({ where: { id: corridorId } })
    const wholesaleRate = await this.fxProvider.fetchWholesaleRate(
      corridor.baseCurrency,
      corridor.targetCurrency,
    )

    const customerRate = calculateCustomerRate(wholesaleRate, spread)

    return prisma.rate.create({
      data: {
        corridorId,
        provider: this.fxProvider.name,
        wholesaleRate,
        spread,
        customerRate,
        effectiveAt: new Date(),
        adminOverride: false,
      },
    })
  }

  /** Admin manually sets the customer rate. Calculates implied spread from wholesale. */
  async setAdminRate(params: {
    corridorId: string
    customerRate: Decimal
    wholesaleRate: Decimal
    adminId: string
  }): Promise<Rate> {
    // Implied spread = 1 - (customerRate / wholesaleRate)
    const impliedSpread = new Decimal(1).minus(params.customerRate.div(params.wholesaleRate))

    return prisma.rate.create({
      data: {
        corridorId: params.corridorId,
        wholesaleRate: params.wholesaleRate,
        spread: impliedSpread,
        customerRate: params.customerRate,
        effectiveAt: new Date(),
        adminOverride: true,
        setById: params.adminId,
      },
    })
  }

  /** Checks if the most recent rate for a corridor is older than 12 hours. */
  async isRateStale(corridorId: string): Promise<{
    stale: boolean
    staleSince?: Date
    hoursStale?: number
  }> {
    const latestRate = await this.getCurrentRate(corridorId)

    if (!latestRate) {
      return { stale: true }
    }

    const ageMs = Date.now() - latestRate.effectiveAt.getTime()
    const ageHours = ageMs / (1000 * 60 * 60)

    if (ageHours > STALE_THRESHOLD_HOURS) {
      return {
        stale: true,
        staleSince: latestRate.effectiveAt,
        hoursStale: Math.floor(ageHours),
      }
    }

    return { stale: false }
  }

  /** Returns recent rates for a corridor, ordered by effectiveAt descending. */
  async getRateHistory(corridorId: string, limit?: number): Promise<Rate[]> {
    return prisma.rate.findMany({
      where: { corridorId },
      orderBy: { effectiveAt: 'desc' },
      take: limit,
    })
  }
}

/**
 * Resolve the current customer rate for a currency pair (active corridor only).
 *
 * Single source of truth for "what is the current customer rate?" used by
 * both the public read-only endpoint (`/api/rates/public`) and any other
 * caller that knows pair but not corridorId. Goes through `RateService` so
 * admin overrides and ordering rules apply uniformly.
 *
 * Returns the corridor + rate pair, or null if either is missing/inactive.
 */
export async function getCurrentRateByPair(
  baseCurrency: string,
  targetCurrency: string,
): Promise<{ corridor: Corridor; rate: Rate } | null> {
  const corridor = await prisma.corridor.findFirst({
    where: { baseCurrency, targetCurrency, active: true },
  })
  if (!corridor) return null

  const rateService = new RateService(new DefaultFxRateProvider())
  const rate = await rateService.getCurrentRate(corridor.id)
  if (!rate) return null

  return { corridor, rate }
}
