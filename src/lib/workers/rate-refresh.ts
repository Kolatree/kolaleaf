import Decimal from 'decimal.js'
import { prisma } from '../db/client'
import { RateService } from '../rates/rate-service'
import { DefaultFxRateProvider } from '../rates/fx-fetcher'

const DEFAULT_SPREAD = new Decimal(process.env.DEFAULT_SPREAD ?? '0.007')

interface CorridorRefreshResult {
  corridorId: string
  success: boolean
  rate?: number
  error?: string
}

export async function refreshAllCorridorRates(): Promise<CorridorRefreshResult[]> {
  const rateService = new RateService(new DefaultFxRateProvider())

  const corridors = await prisma.corridor.findMany({
    where: { active: true },
  })

  const results: CorridorRefreshResult[] = []

  for (const corridor of corridors) {
    try {
      const rate = await rateService.refreshRate(corridor.id, DEFAULT_SPREAD)
      results.push({
        corridorId: corridor.id,
        success: true,
        rate: rate.customerRate.toNumber(),
      })
    } catch (err) {
      results.push({
        corridorId: corridor.id,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return results
}
