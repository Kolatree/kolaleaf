import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { withAdmin } from '@/lib/auth/admin-middleware'
import { prisma } from '@/lib/db/client'
import { RateService, DefaultFxRateProvider } from '@/lib/rates'
import { logAuthEvent } from '@/lib/auth/audit'
import { parseBody } from '@/lib/http/validate'
import { SetAdminRateBody } from './_schemas'

const rateService = new RateService(new DefaultFxRateProvider())

export const GET = withAdmin(async () => {
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
})

export const POST = withAdmin(async (request, userId) => {
  // Auth already ran via withAdmin. Parse body next.
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
})
