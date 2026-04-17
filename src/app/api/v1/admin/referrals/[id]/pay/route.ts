import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { processReward } from '@/lib/referrals'
import { logAuthEvent } from '@/lib/auth/audit'
import { parseBody } from '@/lib/http/validate'
import { PayReferralBody } from './_schemas'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)
    const { id: referralId } = await params

    const parsed = await parseBody(request, PayReferralBody)
    if (!parsed.ok) return parsed.response
    const { amount } = parsed.data

    const referral = await processReward(referralId, new Decimal(amount))

    await logAuthEvent({
      userId,
      event: 'ADMIN_REFERRAL_PAID',
      metadata: { referralId, amount },
    })

    return NextResponse.json({ referral })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Failed to process reward'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
