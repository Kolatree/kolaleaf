import { prisma } from '../db/client'

const STALE_ALERT_HOURS = 12
const BLOCK_TRANSFERS_HOURS = 24

interface CorridorStalenessResult {
  corridorId: string
  corridor: string
  stale: boolean
  hoursStale: number
  blocked: boolean
}

export class StalenessMonitor {
  /** Checks all active corridors for rate staleness. */
  async checkAllCorridorStaleness(): Promise<CorridorStalenessResult[]> {
    const corridors = await prisma.corridor.findMany({
      where: { active: true },
      include: {
        rates: {
          orderBy: { effectiveAt: 'desc' },
          take: 1,
        },
      },
    })

    return corridors.map((corridor) => {
      const latestRate = corridor.rates[0]
      const label = `${corridor.baseCurrency}-${corridor.targetCurrency}`

      if (!latestRate) {
        return {
          corridorId: corridor.id,
          corridor: label,
          stale: true,
          hoursStale: Infinity,
          blocked: true,
        }
      }

      const ageMs = Date.now() - latestRate.effectiveAt.getTime()
      const hoursStale = ageMs / (1000 * 60 * 60)

      return {
        corridorId: corridor.id,
        corridor: label,
        stale: hoursStale > STALE_ALERT_HOURS,
        hoursStale,
        blocked: hoursStale > BLOCK_TRANSFERS_HOURS,
      }
    })
  }

  /** Returns true if the most recent rate for a corridor is >24h old (blocks new transfers). */
  async shouldBlockTransfers(corridorId: string): Promise<boolean> {
    const latestRate = await prisma.rate.findFirst({
      where: { corridorId },
      orderBy: { effectiveAt: 'desc' },
    })

    if (!latestRate) return true

    const ageMs = Date.now() - latestRate.effectiveAt.getTime()
    const ageHours = ageMs / (1000 * 60 * 60)

    return ageHours > BLOCK_TRANSFERS_HOURS
  }
}
