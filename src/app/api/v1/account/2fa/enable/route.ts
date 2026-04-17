import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { verifyTotpCode, generateBackupCodes } from '@/lib/auth/totp'
import { verifyChallenge } from '@/lib/auth/two-factor-challenge'
import { parseBody } from '@/lib/http/validate'
import { Enable2faBody } from './_schemas'

// POST /api/account/2fa/enable
//
// Commits a 2FA enrollment started by /setup. Validates the provided code
// against the freshly-generated secret (TOTP) or the challenge (SMS) and, on
// success, persists the user's new 2FA state + backup codes atomically and
// writes an AuthEvent. The raw backup codes are returned ONCE in the response
// body -- they are never retrievable again.
export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)

    const parsed = await parseBody(request, Enable2faBody)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const { method, code } = body

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.twoFactorMethod !== 'NONE') {
      return NextResponse.json({ error: 'already_enabled' }, { status: 400 })
    }

    if (method === 'TOTP') {
      const { secret } = body
      if (!verifyTotpCode(secret, code)) {
        return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
      }

      const { codes, hashes } = generateBackupCodes()
      const now = new Date()

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            twoFactorMethod: 'TOTP',
            twoFactorSecret: secret,
            twoFactorBackupCodes: hashes,
            twoFactorEnabledAt: now,
          },
        }),
        prisma.authEvent.create({
          data: {
            userId,
            event: 'TWO_FACTOR_ENABLED',
            metadata: { method: 'TOTP' } as Prisma.InputJsonValue,
          },
        }),
      ])

      return NextResponse.json({ enabled: true, backupCodes: codes })
    }

    // SMS branch — `method: 'SMS'` means Zod already narrowed body to
    // include `challengeId`; the discriminated union guarantees it.
    const { challengeId } = body
    const ok = await verifyChallenge(userId, challengeId, code)
    if (!ok) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    const { codes, hashes } = generateBackupCodes()
    const now = new Date()

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorMethod: 'SMS',
          twoFactorSecret: null,
          twoFactorBackupCodes: hashes,
          twoFactorEnabledAt: now,
        },
      }),
      prisma.authEvent.create({
        data: {
          userId,
          event: 'TWO_FACTOR_ENABLED',
          metadata: { method: 'SMS' } as Prisma.InputJsonValue,
        },
      }),
    ])

    return NextResponse.json({ enabled: true, backupCodes: codes })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/2fa/enable]', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
