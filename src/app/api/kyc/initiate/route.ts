import { NextResponse } from 'next/server'
import { initiateKyc } from '@/lib/kyc/sumsub/kyc-service'
import { createSumsubClient } from '@/lib/kyc/sumsub'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const client = createSumsubClient()
    const result = await initiateKyc(userId, client)

    return NextResponse.json({
      applicantId: result.applicantId,
      verificationUrl: result.verificationUrl,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'KYC initiation failed'
    if (message === 'KYC already verified' || message === 'KYC already in review') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
