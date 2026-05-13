import { NextResponse } from 'next/server'
import { verifyTotpCodeWithReplay, verifyBackupCode } from '@/lib/auth/totp'
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
import { jsonError } from '@/lib/http/json-error'
import { log } from '@/lib/obs/logger'
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
      const response = jsonError('expired', '2FA challenge expired', 401)
      response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
      return response
    }

    const user = challenge.user

    if (user.twoFactorMethod === 'NONE') {
      const response = jsonError('not_enabled', '2FA is not enabled', 400)
      response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
      return response
    }

    let verified = false
    let verifiedMethod: 'TOTP' | 'SMS' | 'BACKUP_CODE' | null = null

    if (challenge.method === 'TOTP' && user.twoFactorMethod === 'TOTP' && user.twoFactorSecret) {
      if (await verifyTotpCodeWithReplay(user.twoFactorSecret, code, user.id)) {
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
      // Increment attempts on the TOTP challenge (mirrors the SMS path's
      // verifyChallenge logic which enforces MAX_ATTEMPTS=5).
      if (challenge.method === 'TOTP') {
        const MAX_TOTP_ATTEMPTS = 5
        // Atomic conditional increment: only succeeds if attempts < max.
        // Concurrent requests race on the DB row, not on a stale JS read.
        const updated = await prisma.twoFactorChallenge.updateMany({
          where: { id: challenge.id, attempts: { lt: MAX_TOTP_ATTEMPTS } },
          data: { attempts: { increment: 1 } },
        })
        if (updated.count === 0) {
          // Challenge already exhausted — consume it and clear cookie
          await prisma.twoFactorChallenge.update({
            where: { id: challenge.id },
            data: { consumedAt: new Date() },
          })
          const response = jsonError('expired', '2FA challenge expired', 401)
          response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
          return response
        }
        // Check if this increment just hit the cap
        const current = await prisma.twoFactorChallenge.findUnique({
          where: { id: challenge.id },
          select: { attempts: true },
        })
        if (current && current.attempts >= MAX_TOTP_ATTEMPTS) {
          await prisma.twoFactorChallenge.update({
            where: { id: challenge.id },
            data: { consumedAt: new Date() },
          })
          const response = jsonError('expired', '2FA challenge expired', 401)
          response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
          return response
        }
      }
      return jsonError('invalid_code', 'Invalid 2FA code', 401)
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
      const reason = error.statusCode === 401 ? 'unauthenticated' : 'forbidden'
      return jsonError(reason, error.message, error.statusCode)
    }
    log('error', 'auth.verify-2fa.failed', { error: error instanceof Error ? error.message : String(error) })
    return jsonError('verify_2fa_failed', 'Verification failed', 500)
  }
}
