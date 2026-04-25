import { NextResponse } from 'next/server'
import { checkAndAlertStaleness } from '@/lib/workers/staleness-alert'
import { authorizeCron } from '@/lib/auth/cron-auth'
import { log } from '@/lib/obs/logger'

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await checkAndAlertStaleness()
    return NextResponse.json(result)
  } catch (err) {
    log('error', 'cron.staleness.failed', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Staleness check failed' }, { status: 500 })
  }
}
