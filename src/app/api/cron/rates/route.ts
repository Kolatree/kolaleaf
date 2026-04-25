import { NextResponse } from 'next/server'
import { refreshAllCorridorRates } from '@/lib/workers/rate-refresh'
import { authorizeCron } from '@/lib/auth/cron-auth'
import { log } from '@/lib/obs/logger'

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await refreshAllCorridorRates()
    return NextResponse.json(results)
  } catch (err) {
    log('error', 'cron.rates.failed', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Rate refresh failed' }, { status: 500 })
  }
}
