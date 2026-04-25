import { NextResponse } from 'next/server'
import { runDailyReconciliation } from '@/lib/workers/reconciliation'
import { authorizeCron } from '@/lib/auth/cron-auth'
import { log } from '@/lib/obs/logger'

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runDailyReconciliation()
    return NextResponse.json(report)
  } catch (err) {
    log('error', 'cron.reconciliation.failed', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 })
  }
}
