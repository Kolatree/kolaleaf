import { prisma } from '../db/client'
import { StalenessMonitor } from '../rates/staleness-monitor'
import { alertOps } from '@/lib/obs/alert'

export interface StaleAlert {
  corridorId: string
  corridor: string
  hoursStale: number
}

export interface StalenessAlertResult {
  alerts: StaleAlert[]
  blocked: string[]
}

export async function checkAndAlertStaleness(): Promise<StalenessAlertResult> {
  const monitor = new StalenessMonitor()
  const results = await monitor.checkAllCorridorStaleness()

  const alerts: StaleAlert[] = []
  const blocked: string[] = []

  for (const result of results) {
    if (result.stale) {
      alerts.push({
        corridorId: result.corridorId,
        corridor: result.corridor,
        hoursStale: result.hoursStale,
      })

      // Structured alert — logs AND enqueues an ops email. Fire-and-
      // forget; BullMQ owns delivery durability.
      void alertOps('alert.rate.stale', {
        corridorId: result.corridorId,
        corridor: result.corridor,
        hoursStale: result.hoursStale === Infinity ? null : Math.floor(result.hoursStale),
        blocked: result.blocked,
      })
    }

    if (result.blocked) {
      blocked.push(result.corridorId)
    }
  }

  // Create a compliance report if there are any alerts
  if (alerts.length > 0) {
    await prisma.complianceReport.create({
      data: {
        type: 'SUSPICIOUS',
        details: {
          source: 'staleness_alert_worker',
          alerts: alerts.map((a) => ({
            corridorId: a.corridorId,
            corridor: a.corridor,
            hoursStale: a.hoursStale === Infinity ? 'no_rate' : a.hoursStale,
          })),
          blockedCorridors: blocked,
          checkedAt: new Date().toISOString(),
        },
      },
    })
  }

  return { alerts, blocked }
}
