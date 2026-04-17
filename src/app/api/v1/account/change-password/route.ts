import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import {
  hashPassword,
  verifyPassword,
  validatePasswordComplexity,
} from '@/lib/auth/password'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

// POST /api/account/change-password { currentPassword, newPassword }
//
// Requires the current password as a second factor of intent — a session
// hijacker can read /account but cannot change the password without the
// existing one. On success every OTHER session for this user is deleted
// (force-logout other devices) and an AuthEvent is recorded.
export async function POST(request: Request) {
  let body: { currentPassword?: unknown; newPassword?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : ''
  if (!currentPassword) {
    return NextResponse.json(
      { error: 'Current password is required' },
      { status: 400 },
    )
  }

  const pwCheck = validatePasswordComplexity(body.newPassword)
  if (!pwCheck.ok) {
    return NextResponse.json({ error: pwCheck.error }, { status: 400 })
  }
  const newPassword = pwCheck.password

  try {
    const { userId, session } = await requireAuth(request)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    if (!user.passwordHash) {
      return NextResponse.json(
        { error: 'invalid_credentials' },
        { status: 401 },
      )
    }

    const currentValid = await verifyPassword(currentPassword, user.passwordHash)
    if (!currentValid) {
      await prisma.authEvent.create({
        data: {
          userId,
          event: 'PASSWORD_CHANGE_FAILED',
          metadata: { reason: 'wrong_current_password' },
        },
      })
      return NextResponse.json(
        { error: 'invalid_credentials' },
        { status: 401 },
      )
    }

    const passwordHash = await hashPassword(newPassword)

    // Atomic: password rotation + force-logout of OTHER sessions must land
    // together. Keep the current session alive so the user stays signed in
    // on the device they just used to change the password.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      prisma.session.deleteMany({
        where: { userId, id: { not: session.id } },
      }),
    ])

    await prisma.authEvent.create({
      data: {
        userId,
        event: 'PASSWORD_CHANGED',
        metadata: { via: 'account_self_service' },
      },
    })

    return NextResponse.json({ changed: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/change-password]', error)
    return NextResponse.json(
      { error: 'Unable to change password' },
      { status: 500 },
    )
  }
}
