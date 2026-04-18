import { NextResponse } from 'next/server'
import { retryKyc } from '@/lib/kyc/sumsub/kyc-service'
import { createSumsubClient } from '@/lib/kyc/sumsub'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

// POST /api/v1/kyc/retry
//
// Exists because retryKyc() in kyc-service.ts was implemented and
// tested but had no HTTP route — a REJECTED user had no way to try
// again (Wave 1 audit P0 gap #4). This wraps the existing function
// with the same 409-on-wrong-state + 401-on-unauth conventions as
// /kyc/initiate.
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const client = createSumsubClient()
    const result = await retryKyc(userId, client)
    return NextResponse.json({
      accessToken: result.accessToken,
      verificationUrl: result.verificationUrl,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'KYC retry failed'
    if (
      message === 'KYC retry only available for rejected applications' ||
      message === 'No existing KYC application to retry'
    ) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
