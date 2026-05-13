import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { parseBody } from '@/lib/http/validate'
import { jsonError } from '@/lib/http/json-error'
import { prisma } from '@/lib/db/client'
import { handleKycApproved, handleKycRejected } from '@/lib/kyc/sumsub/kyc-service'
import { CompleteMockKycBody } from './_schemas'

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return jsonError('not_found', 'Not found', 404)
    }

    const { userId } = await requireAuth(request)
    const parsed = await parseBody(request, CompleteMockKycBody)
    if (!parsed.ok) return parsed.response

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { kycStatus: true, kycProviderId: true },
    })

    if (!user.kycProviderId) {
      return jsonError('kyc_no_application', 'No KYC application in progress', 409)
    }

    if (user.kycStatus === 'VERIFIED') {
      return jsonError('kyc_already_verified', 'KYC already verified', 409)
    }

    if (parsed.data.outcome === 'approve') {
      await handleKycApproved(userId)
      return NextResponse.json({ status: 'VERIFIED' })
    }

    await handleKycRejected(userId, ['MOCK_REJECTED'])
    return NextResponse.json({ status: 'REJECTED' })
  } catch (error) {
    if (error instanceof AuthError) {
      const reason = error.statusCode === 401 ? 'unauthenticated' : 'forbidden'
      return jsonError(reason, error.message, error.statusCode)
    }

    const message = error instanceof Error ? error.message : 'Mock KYC completion failed'
    return jsonError('mock_kyc_complete_failed', message, 500)
  }
}
