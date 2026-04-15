import { NextResponse } from 'next/server'
import { runDailyReconciliation } from '@/lib/workers/reconciliation'
import { authorizeCron } from '@/lib/auth/cron-auth'

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runDailyReconciliation()
    return NextResponse.json(report)
  } catch (err) {
    console.error('[cron/reconciliation]', err)
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 })
  }
}
