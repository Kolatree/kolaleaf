import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { verifyTotpCode, verifyBackupCode, generateBackupCodes } from '@/lib/auth/totp'
import { verifyChallenge } from '@/lib/auth/two-factor-challenge'

// POST /api/account/2fa/regenerate-backup-codes
//
// Replaces the user's backup codes with 8 fresh ones. Requires 2FA be enabled
// and the caller to prove possession by submitting a current TOTP code, a
// fresh SMS challenge, or a currently-valid backup code. Returns the raw
// codes ONCE so the user can save them; only hashes are persisted.
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)

    const body = (await request.json().catch(() => null)) as
      | { code?: unknown; challengeId?: unknown }
      | null

    const code = typeof body?.code === 'string' ? body.code : ''
    const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : null
    if (!code) {
      return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.twoFactorMethod === 'NONE') {
      return NextResponse.json({ error: 'not_enabled' }, { status: 400 })
    }

    let verified = false

    if (user.twoFactorMethod === 'TOTP' && user.twoFactorSecret) {
      verified = verifyTotpCode(user.twoFactorSecret, code)
    } else if (user.twoFactorMethod === 'SMS' && challengeId) {
      verified = await verifyChallenge(userId, challengeId, code)
    }

    if (!verified) {
      const result = await verifyBackupCode(code, user.twoFactorBackupCodes)
      if (result.valid) {
        verified = true
      }
    }

    if (!verified) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    const { codes, hashes } = generateBackupCodes()

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: hashes },
      }),
      prisma.authEvent.create({
        data: {
          userId,
          event: 'TWO_FACTOR_BACKUP_CODES_REGENERATED',
          metadata: {
            method: user.twoFactorMethod,
          } as Prisma.InputJsonValue,
        },
      }),
    ])

    return NextResponse.json({ backupCodes: codes })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/2fa/regenerate-backup-codes]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
