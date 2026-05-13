import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { logAuthEvent } from '@/lib/auth/audit'
import {
  generateTotpSecret,
  buildOtpauthUri,
  generateQrCodeDataUrl,
} from '@/lib/auth/totp'
import { issueSmsChallenge } from '@/lib/auth/two-factor-challenge'
import { parseBody } from '@/lib/http/validate'
import { jsonError } from '@/lib/http/json-error'
import { log } from '@/lib/obs/logger'
import { Setup2faBody } from './_schemas'

// POST /api/account/2fa/setup
//
// Kicks off 2FA enrollment. For TOTP, returns a fresh secret + QR code so the
// user can scan it in an authenticator app -- the secret is NOT persisted here;
// it's echoed back to the client and only committed on the follow-up /enable
// call. For SMS, requires the user has a verified PHONE identifier; if so,
// issues a challenge and returns its id.
//
// Writes AuthEvent TWO_FACTOR_SETUP_INITIATED so the audit trail captures
// both successful and abandoned enrollment attempts.
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)

    const parsed = await parseBody(request, Setup2faBody)
    if (!parsed.ok) return parsed.response
    const { method } = parsed.data

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.twoFactorMethod !== 'NONE') {
      return jsonError('already_enabled', 'Two-factor authentication is already enabled.', 400)
    }

    if (method === 'TOTP') {
      // Use the user's primary verified email as the otpauth label so it
      // shows up as a distinguishable account name in the authenticator app.
      const email = await prisma.userIdentifier.findFirst({
        where: { userId, type: 'EMAIL' },
        orderBy: { createdAt: 'asc' },
      })
      if (!email) {
        return jsonError('email_required', 'A verified email is required to set up an authenticator app.', 400)
      }

      const secret = generateTotpSecret()
      const otpauthUri = buildOtpauthUri({
        secret,
        accountLabel: email.identifier,
        issuer: 'Kolaleaf',
      })
      const qrDataUrl = await generateQrCodeDataUrl(otpauthUri)

      await logAuthEvent({
        userId,
        event: 'TWO_FACTOR_SETUP_INITIATED',
        metadata: { method: 'TOTP' },
      })

      return NextResponse.json({
        method: 'TOTP',
        secret,
        otpauthUri,
        qrDataUrl,
      })
    }

    // SMS branch
    const phone = await prisma.userIdentifier.findFirst({
      where: { userId, type: 'PHONE', verified: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!phone) {
      return jsonError('phone_not_verified', 'Verify your phone number before enabling SMS codes.', 400)
    }

    const { challengeId } = await issueSmsChallenge(userId, phone.identifier)

    await logAuthEvent({
      userId,
      event: 'TWO_FACTOR_SETUP_INITIATED',
      metadata: { method: 'SMS' },
    })

    return NextResponse.json({ method: 'SMS', challengeId })
  } catch (error) {
    if (error instanceof AuthError) {
      const reason = error.statusCode === 401 ? 'unauthenticated' : 'forbidden'
      return jsonError(reason, error.message, error.statusCode)
    }
    log('error', 'account.2fa.setup.failed', { error: error instanceof Error ? error.message : String(error) })
    return jsonError('server_error', 'Server error', 500)
  }
}
