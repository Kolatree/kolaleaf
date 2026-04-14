import { NextResponse } from 'next/server'
import Decimal from 'decimal.js'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { processReward } from '@/lib/referrals'
import { logAuthEvent } from '@/lib/auth/audit'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAdmin(request)
    const { id: referralId } = await params

    let body: { amount?: string | number }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    if (body.amount === undefined || body.amount === null) {
      return NextResponse.json({ error: 'amount is required' }, { status: 400 })
    }

    const referral = await processReward(referralId, new Decimal(String(body.amount)))

    await logAuthEvent({
      userId,
      event: 'ADMIN_REFERRAL_PAID',
      metadata: { referralId, amount: String(body.amount) },
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
