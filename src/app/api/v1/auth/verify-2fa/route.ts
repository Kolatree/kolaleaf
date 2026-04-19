import { NextResponse } from 'next/server'
import { verifyTotpCode, verifyBackupCode } from '@/lib/auth/totp'
import { consumeChallenge, verifyChallenge } from '@/lib/auth/two-factor-challenge'
import {
  AuthError,
  clearPendingTwoFactorCookie,
  requirePendingTwoFactorChallenge,
  setSessionCookie,
} from '@/lib/auth/middleware'
import { logAuthEvent } from '@/lib/auth/audit'
import { prisma } from '@/lib/db/client'
import { createSession } from '@/lib/auth/sessions'
import { extractRequestContext } from '@/lib/security/request-context'
import { recordSecurityAnomalyCheck } from '@/lib/security/anomaly'
import { parseBody } from '@/lib/http/validate'
import { Verify2faBody } from './_schemas'

// POST /api/v1/auth/verify-2fa
//
// Accepts either:
//   { code }                — TOTP code from authenticator app, OR a backup code
//   { code, challengeId }   — SMS 2FA code with its issued challenge
//
// On success writes an AuthEvent with metadata.method indicating which path
// verified (TOTP, SMS, or BACKUP_CODE). Backup codes are consumed on use.
export async function POST(request: Request) {
  try {
    const { challengeId } = requirePendingTwoFactorChallenge(request)

    const parsed = await parseBody(request, Verify2faBody)
    if (!parsed.ok) return parsed.response
    const { code } = parsed.data

    const challenge = await prisma.twoFactorChallenge.findUnique({
      where: { id: challengeId },
      include: { user: true },
    })
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      const response = NextResponse.json({ error: '2FA challenge expired' }, { status: 401 })
      response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
      return response
    }

    const user = challenge.user

    if (user.twoFactorMethod === 'NONE') {
      const response = NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
      response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
      return response
    }

    let verified = false
    let verifiedMethod: 'TOTP' | 'SMS' | 'BACKUP_CODE' | null = null

    if (challenge.method === 'TOTP' && user.twoFactorMethod === 'TOTP' && user.twoFactorSecret) {
      if (verifyTotpCode(user.twoFactorSecret, code)) {
        await consumeChallenge(challenge.id)
        verified = true
        verifiedMethod = 'TOTP'
      }
    }

    if (!verified && challenge.method === 'SMS' && user.twoFactorMethod === 'SMS') {
      const ok = await verifyChallenge(user.id, challenge.id, code)
      if (ok) {
        verified = true
        verifiedMethod = 'SMS'
      }
    }

    let backupCodeUsed = false
    let backupCodesRemaining: number | undefined
    if (!verified) {
      const { valid, remainingHashes } = await verifyBackupCode(code, user.twoFactorBackupCodes)
      if (valid) {
        await prisma.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: remainingHashes },
        })
        await consumeChallenge(challenge.id)
        verified = true
        verifiedMethod = 'BACKUP_CODE'
        backupCodeUsed = true
        backupCodesRemaining = remainingHashes.length
      }
    }

    if (!verified || !verifiedMethod) {
      return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 })
    }

    const securityContext = extractRequestContext(request)
    const { ip, userAgent } = securityContext
    const session = await createSession(user.id, ip, userAgent)
    const observedAt = new Date()

    await logAuthEvent({
      userId: user.id,
      event: 'TWO_FACTOR_VERIFIED',
      ip,
      metadata: {
        method: verifiedMethod,
        ...(backupCodeUsed && backupCodesRemaining !== undefined
          ? { remaining: backupCodesRemaining }
          : {}),
      },
    })
    await logAuthEvent({
      userId: user.id,
      event: 'LOGIN',
      ip,
      metadata: {
        requires2FA: true,
        twoFactorMethod: user.twoFactorMethod,
        ...(securityContext.country ? { country: securityContext.country } : {}),
        ...(securityContext.deviceFingerprintHash
          ? { deviceFingerprintHash: securityContext.deviceFingerprintHash }
          : {}),
      },
    })

    void recordSecurityAnomalyCheck({
      userId: user.id,
      context: securityContext,
      event: 'LOGIN',
      observedAt,
    }).catch(() => {
      /* logged inside recordSecurityAnomalyCheck */
    })

    const response = NextResponse.json({
      verified: true,
      ...(backupCodeUsed ? { backupCodeUsed: true, remaining: backupCodesRemaining } : {}),
    })
    response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
    response.headers.append('Set-Cookie', setSessionCookie(session.token))
    return response
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[auth/verify-2fa]', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
