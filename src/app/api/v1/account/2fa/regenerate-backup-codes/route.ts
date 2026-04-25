import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { verifyTotpCodeWithReplay, verifyBackupCode, generateBackupCodes } from '@/lib/auth/totp'
import { verifyChallenge } from '@/lib/auth/two-factor-challenge'
import { parseBody } from '@/lib/http/validate'
import { log } from '@/lib/obs/logger'
import { RegenerateBackupCodesBody } from './_schemas'

// POST /api/account/2fa/regenerate-backup-codes
//
// Replaces the user's backup codes with 8 fresh ones. Requires 2FA be enabled
// and the caller to prove possession by submitting a current TOTP code, a
// fresh SMS challenge, or a currently-valid backup code. Returns the raw
// codes ONCE so the user can save them; only hashes are persisted.
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)

    const parsed = await parseBody(request, RegenerateBackupCodesBody)
    if (!parsed.ok) return parsed.response
    const { code, challengeId: rawChallengeId } = parsed.data
    const challengeId = rawChallengeId ?? null

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.twoFactorMethod === 'NONE') {
      return NextResponse.json({ error: 'not_enabled' }, { status: 400 })
    }

    let verified = false

    if (user.twoFactorMethod === 'TOTP' && user.twoFactorSecret) {
      verified = await verifyTotpCodeWithReplay(user.twoFactorSecret, code, user.id)
    } else if (user.twoFactorMethod === 'SMS' && challengeId) {
      verified = await verifyChallenge(userId, challengeId, code)
    }

    // Track remaining hashes when a backup code is used, so the consumed
    // code is removed in the same transaction that generates new ones.
    let backupRemainingHashes: string[] | null = null
    if (!verified) {
      const result = await verifyBackupCode(code, user.twoFactorBackupCodes)
      if (result.valid) {
        verified = true
        backupRemainingHashes = result.remainingHashes
      }
    }

    if (!verified) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    const { codes, hashes } = generateBackupCodes()

    // When verified via backup code, the consumed code's hash must be
    // removed. We write `backupRemainingHashes` (minus the used code)
    // merged with the fresh hashes — but since we're regenerating ALL
    // codes, the new `hashes` fully replace the old set regardless.
    // The key point: the old consumed code is no longer in the DB.
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
            ...(backupRemainingHashes !== null ? { viaBackupCode: true } : {}),
          } as Prisma.InputJsonValue,
        },
      }),
    ])

    return NextResponse.json({ backupCodes: codes })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    log('error', 'account.2fa.regenerate-backup-codes.failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
