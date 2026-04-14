import { prisma } from '../db/client'
import { StalenessMonitor } from '../rates/staleness-monitor'

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

      // Log the alert (placeholder for email/push notification)
      console.log(
        `[STALENESS ALERT] ${result.corridor}: rate is ${
          result.hoursStale === Infinity ? 'missing' : `${Math.floor(result.hoursStale)}h stale`
        }${result.blocked ? ' — BLOCKED' : ''}`,
      )
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
