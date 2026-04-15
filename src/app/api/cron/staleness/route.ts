import { NextResponse } from 'next/server'
import { checkAndAlertStaleness } from '@/lib/workers/staleness-alert'
import { authorizeCron } from '@/lib/auth/cron-auth'

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await checkAndAlertStaleness()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/staleness]', err)
    return NextResponse.json({ error: 'Staleness check failed' }, { status: 500 })
  }
}
