import { NextResponse } from 'next/server'
import { getKycStatus } from '@/lib/kyc/sumsub/kyc-service'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const status = await getKycStatus(userId)
    return NextResponse.json(status)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to get KYC status' }, { status: 500 })
  }
}
