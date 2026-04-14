import { NextResponse } from 'next/server'
import { refreshAllCorridorRates } from '@/lib/workers/rate-refresh'

export async function POST(request: Request) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = await refreshAllCorridorRates()
    return NextResponse.json(results)
  } catch {
    return NextResponse.json({ error: 'Rate refresh failed' }, { status: 500 })
  }
}
