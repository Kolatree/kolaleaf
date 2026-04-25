import { NextResponse } from 'next/server'
import { checkAndAlertFloat } from '@/lib/workers/float-alert'
import { authorizeCron } from '@/lib/auth/cron-auth'
import { log } from '@/lib/obs/logger'

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await checkAndAlertFloat()
    return NextResponse.json({
      balance: result.balance.toString(),
      threshold: result.threshold.toString(),
      sufficient: result.sufficient,
      pausedCount: result.pausedCount,
      resumedCount: result.resumedCount,
    })
  } catch (err) {
    log('error', 'cron.float.failed', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Float check failed' }, { status: 500 })
  }
}
