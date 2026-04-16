import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { createFlutterwaveProvider } from '@/lib/payments/payout/flutterwave'

/**
 * GET /api/banks?country=NG
 *
 * Returns the bank list for a remittance corridor's destination country.
 * Account-config info, not public — requires an authenticated session.
 *
 * Only NG is accepted today. New corridors add their own ISO country code
 * when the corresponding payout adapter lands (AU, KE, etc.). Rejecting
 * unknown codes with 400 keeps the multi-corridor boundary explicit.
 */
export async function GET(request: Request) {
  try {
    await requireAuth(request)

    const { searchParams } = new URL(request.url)
    const country = searchParams.get('country')

    if (country !== 'NG') {
      return NextResponse.json(
        { error: 'unsupported_country' },
        { status: 400 },
      )
    }

    const provider = createFlutterwaveProvider()
    const banks = await provider.listBanks('NG')

    return NextResponse.json(
      { banks },
      {
        status: 200,
        headers: {
          // User-scoped: caches on the browser only, not in a shared proxy.
          // 1h TTL — well under the adapter's 24h in-memory cache.
          'Cache-Control': 'private, max-age=3600',
        },
      },
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      )
    }
    return NextResponse.json(
      { error: 'banks_unavailable' },
      { status: 503 },
    )
  }
}
