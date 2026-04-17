import { NextResponse } from 'next/server'
import { verifyTotpCode, verifyBackupCode } from '@/lib/auth/totp'
import { verifyChallenge } from '@/lib/auth/two-factor-challenge'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { logAuthEvent } from '@/lib/auth/audit'
import { prisma } from '@/lib/db/client'

// POST /api/auth/verify-2fa
//
// Accepts either:
//   { code }                — TOTP code from authenticator app, OR a backup code
//   { code, challengeId }   — SMS 2FA code with its issued challenge
//
// On success writes an AuthEvent with metadata.method indicating which path
// verified (TOTP, SMS, or BACKUP_CODE). Backup codes are consumed on use.
export async function POST(request: Request) {
  let body: { code?: string; challengeId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { code, challengeId } = body
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'A verification code is required' }, { status: 400 })
  }

  try {
    const { userId } = await requireAuth(request)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    if (user.twoFactorMethod === 'NONE') {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 })
    }

    // Path 1: TOTP code against the user's secret.
    if (user.twoFactorMethod === 'TOTP' && user.twoFactorSecret) {
      if (verifyTotpCode(user.twoFactorSecret, code)) {
        await logAuthEvent({
          userId: user.id,
          event: 'TWO_FACTOR_VERIFIED',
          metadata: { method: 'TOTP' },
        })
        return NextResponse.json({ verified: true })
      }
    }

    // Path 2: SMS challenge. Requires the challengeId issued at login.
    if (user.twoFactorMethod === 'SMS' && challengeId) {
      const ok = await verifyChallenge(user.id, challengeId, code)
      if (ok) {
        await logAuthEvent({
          userId: user.id,
          event: 'TWO_FACTOR_VERIFIED',
          metadata: { method: 'SMS' },
        })
        return NextResponse.json({ verified: true })
      }
    }

    // Path 3: backup code — works regardless of primary 2FA method so a
    // user who lost their phone or authenticator can still get in.
    const { valid, remainingHashes } = await verifyBackupCode(code, user.twoFactorBackupCodes)
    if (valid) {
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorBackupCodes: remainingHashes },
      })
      await logAuthEvent({
        userId: user.id,
        event: 'TWO_FACTOR_VERIFIED',
        metadata: { method: 'BACKUP_CODE', remaining: remainingHashes.length },
      })
      return NextResponse.json({ verified: true, backupCodeUsed: true, remaining: remainingHashes.length })
    }

    return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[auth/verify-2fa]', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
