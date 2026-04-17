import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { verifyTotpCode, verifyBackupCode } from '@/lib/auth/totp'
import { verifyChallenge } from '@/lib/auth/two-factor-challenge'
import { parseBody } from '@/lib/http/validate'
import { Disable2faBody } from './_schemas'

// POST /api/account/2fa/disable
//
// Turns off 2FA for the authenticated user. The caller must prove possession
// of one of:
//   - a current TOTP code (if method=TOTP)
//   - a valid SMS challenge (if method=SMS, caller must have obtained a fresh
//     challengeId by calling /setup first -- see brief note below)
//   - OR any un-consumed backup code (works regardless of method)
//
// On success, the user's 2FA columns are cleared, all OTHER sessions are
// deleted (force-logout all other devices -- a disable is a security-sensitive
// action and we don't want a stolen session surviving), and an AuthEvent is
// written.
//
// SMS disable flow: clients should call `/api/account/2fa/setup` with
// method=SMS to issue a fresh challenge, then call this route with
// `{ code, challengeId }`. Alternatively, users can supply any backup code
// regardless of their configured method.
export async function POST(request: Request) {
  try {
    const { userId, session } = await requireAuth(request)

    const parsed = await parseBody(request, Disable2faBody)
    if (!parsed.ok) return parsed.response
    const { code, challengeId: rawChallengeId } = parsed.data
    const challengeId = rawChallengeId ?? null

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.twoFactorMethod === 'NONE') {
      return NextResponse.json({ error: 'not_enabled' }, { status: 400 })
    }

    // Try primary method first.
    let verified = false
    let usedBackupCode = false

    if (user.twoFactorMethod === 'TOTP' && user.twoFactorSecret) {
      verified = verifyTotpCode(user.twoFactorSecret, code)
    } else if (user.twoFactorMethod === 'SMS' && challengeId) {
      verified = await verifyChallenge(userId, challengeId, code)
    }

    // Fallback: any backup code works regardless of configured method, so a
    // user who lost their phone or authenticator can still turn 2FA off.
    if (!verified) {
      const result = await verifyBackupCode(code, user.twoFactorBackupCodes)
      if (result.valid) {
        verified = true
        usedBackupCode = true
      }
    }

    if (!verified) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    // Atomic disable: clear 2FA state + force-logout other devices + audit.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorMethod: 'NONE',
          twoFactorSecret: null,
          twoFactorBackupCodes: [],
          twoFactorEnabledAt: null,
        },
      }),
      prisma.session.deleteMany({
        where: { userId, id: { not: session.id } },
      }),
      prisma.authEvent.create({
        data: {
          userId,
          event: 'TWO_FACTOR_DISABLED',
          metadata: {
            viaBackupCode: usedBackupCode,
          } as Prisma.InputJsonValue,
        },
      }),
    ])

    return NextResponse.json({ disabled: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/2fa/disable]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
