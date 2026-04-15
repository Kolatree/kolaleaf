import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { hashPassword, validatePasswordComplexity } from '@/lib/auth/password'
import { hashToken } from '@/lib/auth/tokens'

const GENERIC_INVALID = 'Invalid or expired reset link.'

/**
 * POST /api/auth/reset-password { token, newPassword }
 *
 * Validates the reset token, updates the password, marks the token used, and
 * force-logs-out every active session for the user. Security baseline — a
 * password reset must invalidate all in-flight sessions.
 */
export async function POST(request: Request) {
  let body: { token?: unknown; newPassword?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawToken = typeof body.token === 'string' ? body.token : ''
  if (!rawToken) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }

  const pwCheck = validatePasswordComplexity(body.newPassword)
  if (!pwCheck.ok) {
    return NextResponse.json({ error: pwCheck.error }, { status: 400 })
  }
  const newPassword = body.newPassword as string

  try {
    const tokenHash = hashToken(rawToken)
    const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })

    if (!token || token.usedAt !== null || token.expiresAt < new Date()) {
      return NextResponse.json({ error: GENERIC_INVALID }, { status: 400 })
    }

    const passwordHash = await hashPassword(newPassword)

    // Atomic: password change + token consumption + force-logout must land
    // together. If any step fails, the token must remain unused so the user
    // can retry — a partial state where the token is consumed but the password
    // didn't change would lock the user out.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      // Force-logout everywhere.
      prisma.session.deleteMany({ where: { userId: token.userId } }),
    ])

    // AuthEvent is best-effort and intentionally outside the transaction:
    // a missing audit row is preferable to rolling back a successful reset.
    await prisma.authEvent.create({
      data: {
        userId: token.userId,
        event: 'PASSWORD_RESET',
        metadata: { via: 'reset-token' },
      },
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error('[auth/reset-password]', error)
    return NextResponse.json({ error: 'Unable to reset password' }, { status: 500 })
  }
}
