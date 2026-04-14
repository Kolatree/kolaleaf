import { NextResponse } from 'next/server'
import { checkAndAlertFloat } from '@/lib/workers/float-alert'

export async function POST(request: Request) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
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
  } catch {
    return NextResponse.json({ error: 'Float check failed' }, { status: 500 })
  }
}
