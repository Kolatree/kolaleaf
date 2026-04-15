import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

// Public read-only rate endpoint.
//
// Returns the most recent customer rate for an active corridor, keyed by
// currency pair rather than cuid. Unauthenticated and cache-friendly so the
// landing page and the send page share one source of truth without needing
// to know the corridor's internal id.
//
// IMPORTANT: do not expose `wholesaleRate`, `spread`, `provider`,
// `adminOverride`, or `setById`. Those are internal treasury / audit fields.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawBase = url.searchParams.get('base')
  const rawTarget = url.searchParams.get('target')

  if (!rawBase) {
    return NextResponse.json({ error: 'base is required' }, { status: 400 })
  }
  if (!rawTarget) {
    return NextResponse.json({ error: 'target is required' }, { status: 400 })
  }

  const baseCurrency = rawBase.trim().toUpperCase()
  const targetCurrency = rawTarget.trim().toUpperCase()

  try {
    const corridor = await prisma.corridor.findFirst({
      where: { baseCurrency, targetCurrency, active: true },
    })

    if (!corridor) {
      return NextResponse.json({ error: 'corridor_not_found' }, { status: 404 })
    }

    const rate = await prisma.rate.findFirst({
      where: { corridorId: corridor.id },
      orderBy: { effectiveAt: 'desc' },
    })

    if (!rate) {
      return NextResponse.json({ error: 'corridor_not_found' }, { status: 404 })
    }

    return NextResponse.json(
      {
        baseCurrency,
        targetCurrency,
        corridorId: corridor.id,
        customerRate: rate.customerRate.toString(),
        effectiveAt: rate.effectiveAt.toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
        },
      },
    )
  } catch {
    return NextResponse.json({ error: 'Failed to get rate' }, { status: 500 })
  }
}
