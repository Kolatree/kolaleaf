import { NextResponse } from 'next/server'
import { getKycAccessToken } from '@/lib/kyc/sumsub/kyc-service'
import { createSumsubClient } from '@/lib/kyc/sumsub'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { jsonError } from '@/lib/http/json-error'

export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const client = createSumsubClient()
    const result = await getKycAccessToken(userId, client)

    return NextResponse.json({
      applicantId: result.applicantId,
      accessToken: result.accessToken,
      verificationUrl: result.verificationUrl,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const reason = error.statusCode === 401 ? 'unauthenticated' : 'forbidden'
      return jsonError(reason, error.message, error.statusCode)
    }

    const message = error instanceof Error ? error.message : 'KYC token refresh failed'
    if (message === 'KYC already verified') {
      return jsonError('kyc_already_verified', message, 409)
    }
    if (message === 'No KYC application in progress') {
      return jsonError('kyc_no_application', message, 409)
    }

    return jsonError('kyc_access_token_failed', message, 500)
  }
}
