import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { RateService, DefaultFxRateProvider } from '@/lib/rates'
import { logAuthEvent } from '@/lib/auth/audit'
import { parseBody } from '@/lib/http/validate'
import { SetAdminRateBody } from './_schemas'

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
    // Auth MUST run before Zod — returning a 422 on a schema failure
    // for an unauthenticated request would leak that the endpoint
    // exists to unauth callers (trivial, but 401-first is the norm
    // across the codebase, so matching it).
    const { userId } = await requireAdmin(request)

    const parsed = await parseBody(request, SetAdminRateBody)
    if (!parsed.ok) return parsed.response
    const { corridorId, customerRate, wholesaleRate } = parsed.data

    const rate = await rateService.setAdminRate({
      corridorId,
      customerRate: new Decimal(customerRate),
      wholesaleRate: new Decimal(wholesaleRate),
      adminId: userId,
    })

    await logAuthEvent({
      userId,
      event: 'ADMIN_RATE_OVERRIDE',
      metadata: { corridorId, customerRate, wholesaleRate },
    })

    return NextResponse.json({ rate }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to set rate' }, { status: 500 })
  }
}
