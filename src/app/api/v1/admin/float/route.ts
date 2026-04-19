import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { FloatMonitor } from '@/lib/payments/payout'
import { FlutterwaveProvider } from '@/lib/payments/payout/flutterwave'

const floatProvider = new FlutterwaveProvider({
  secretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? '',
  apiUrl: process.env.FLUTTERWAVE_API_URL ?? 'https://api.flutterwave.com/v3',
})

const floatMonitor = new FloatMonitor(floatProvider)

export async function GET(request: Request) {
  try {
    await requireAdmin(request)

    const result = await floatMonitor.checkFloatBalance()
    const threshold = process.env.MIN_FLOAT_BALANCE_NGN ?? '500000'

    return NextResponse.json({
      float: {
        provider: result.provider,
        balance: result.balance.toString(),
        sufficient: result.sufficient,
        threshold,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to fetch float status' }, { status: 500 })
  }
}
