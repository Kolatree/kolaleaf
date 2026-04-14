import { NextResponse } from 'next/server'
import { checkAndAlertStaleness } from '@/lib/workers/staleness-alert'

export async function POST(request: Request) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await checkAndAlertStaleness()
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Staleness check failed' }, { status: 500 })
  }
}
