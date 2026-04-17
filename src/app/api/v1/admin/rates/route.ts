import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { RateService, DefaultFxRateProvider } from '@/lib/rates'
import { logAuthEvent } from '@/lib/auth/audit'

const rateService = new RateService(new DefaultFxRateProvider())

export async function GET(request: Request) {
  try {
    await requireAdmin(request)

    const corridors = await prisma.corridor.findMany({ where: { active: true } })
    const rates = await Promise.all(
      corridors.map(async (corridor) => {
        const currentRate = await rateService.getCurrentRate(corridor.id)
        const staleness = await rateService.isRateStale(corridor.id)
        const history = await rateService.getRateHistory(corridor.id, 20)
        return {
          corridor: {
            id: corridor.id,
            baseCurrency: corridor.baseCurrency,
            targetCurrency: corridor.targetCurrency,
          },
          currentRate,
          stale: staleness.stale,
          hoursStale: staleness.hoursStale,
          history,
        }
      }),
    )

    return NextResponse.json({ rates })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireAdmin(request)

    let body: { corridorId?: string; customerRate?: string | number; wholesaleRate?: string | number }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { corridorId, customerRate, wholesaleRate } = body
    if (!corridorId || typeof corridorId !== 'string') {
      return NextResponse.json({ error: 'corridorId is required' }, { status: 400 })
    }
    if (customerRate === undefined || customerRate === null) {
      return NextResponse.json({ error: 'customerRate is required' }, { status: 400 })
    }
    if (wholesaleRate === undefined || wholesaleRate === null) {
      return NextResponse.json({ error: 'wholesaleRate is required' }, { status: 400 })
    }

    const rate = await rateService.setAdminRate({
      corridorId,
      customerRate: new Decimal(String(customerRate)),
      wholesaleRate: new Decimal(String(wholesaleRate)),
      adminId: userId,
    })

    await logAuthEvent({
      userId,
      event: 'ADMIN_RATE_OVERRIDE',
      metadata: { corridorId, customerRate: String(customerRate), wholesaleRate: String(wholesaleRate) },
    })

    return NextResponse.json({ rate }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to set rate' }, { status: 500 })
  }
}
