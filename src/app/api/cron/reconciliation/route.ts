import { NextResponse } from 'next/server'
import { runDailyReconciliation } from '@/lib/workers/reconciliation'

export async function POST(request: Request) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runDailyReconciliation()
    return NextResponse.json(report)
  } catch {
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 })
  }
}
