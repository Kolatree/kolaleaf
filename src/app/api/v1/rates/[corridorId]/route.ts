// DEPRECATED: kept for internal/admin use. New code should call
// /api/rates/public?base=...&target=... or use rateService directly.
import { NextResponse } from 'next/server'
import { RateService } from '@/lib/rates'
import { DefaultFxRateProvider } from '@/lib/rates'

const rateService = new RateService(new DefaultFxRateProvider())

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ corridorId: string }> },
) {
  try {
    const { corridorId } = await params
    const rate = await rateService.getCurrentRate(corridorId)

    if (!rate) {
      return NextResponse.json({ error: 'No rate available for this corridor' }, { status: 404 })
    }

    return NextResponse.json({
      corridorId: rate.corridorId,
      customerRate: rate.customerRate.toString(),
      effectiveAt: rate.effectiveAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/rates/[corridorId]]', err)
    return NextResponse.json({ error: 'Failed to get rate' }, { status: 500 })
  }
}
