import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from '@/lib/auth/password'
import { generateVerificationToken } from '@/lib/auth/tokens'
import { sendEmail, renderVerificationEmail } from '@/lib/email'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

const VERIFICATION_TTL_HOURS = 24

// POST /api/account/change-email { currentPassword, newEmail }
//
// Starts the change-email flow. Requires the current password to prove intent.
// Creates an unverified UserIdentifier for the new email and sends a
// verification link. When the user clicks the link, the existing
// GET /api/auth/verify-email route flips the identifier to verified — no
// changes needed there.
//
// Leaves the old email in place until the user removes it via
// DELETE /api/account/email/[id], so the user cannot lock themselves out
// by fat-fingering the new address.
export async function POST(request: Request) {
  let body: { currentPassword?: unknown; newEmail?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newEmail =
    typeof body.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : ''

  if (!currentPassword) {
    return NextResponse.json(
      { error: 'Current password is required' },
      { status: 400 },
    )
  }
  if (!newEmail || !newEmail.includes('@')) {
    return NextResponse.json(
      { error: 'Valid new email is required' },
      { status: 400 },
    )
  }

  try {
    const { userId } = await requireAuth(request)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

    if (!user.passwordHash) {
      return NextResponse.json(
        { error: 'invalid_credentials' },
        { status: 401 },
      )
    }

    const passwordValid = await verifyPassword(currentPassword, user.passwordHash)
    if (!passwordValid) {
      await prisma.authEvent.create({
        data: {
          userId,
          event: 'EMAIL_CHANGE_FAILED',
          metadata: { reason: 'wrong_current_password', newEmail },
        },
      })
      return NextResponse.json(
        { error: 'invalid_credentials' },
        { status: 401 },
      )
    }

    // Check ownership of the target email. UserIdentifier.identifier is
    // globally unique, so there is at most one row.
    const existing = await prisma.userIdentifier.findUnique({
      where: { identifier: newEmail },
    })

    if (existing && existing.userId !== userId && existing.verified) {
      return NextResponse.json({ error: 'email_taken' }, { status: 409 })
    }

    // If the row exists under a different user but is unverified, transfer
    // ownership (same pattern as phone/add — an unverified claim doesn't
    // block a verified change).
    let identifierId: string
    if (existing) {
      if (existing.userId !== userId) {
        const updated = await prisma.userIdentifier.update({
          where: { id: existing.id },
          data: { userId, verified: false, verifiedAt: null },
        })
        identifierId = updated.id
      } else {
        identifierId = existing.id
      }
    } else {
      const created = await prisma.userIdentifier.create({
        data: {
          userId,
          type: 'EMAIL',
          identifier: newEmail,
          verified: false,
        },
      })
      identifierId = created.id
    }

    // Invalidate any outstanding unused tokens for this user+email before
    // minting a new one.
    await prisma.emailVerificationToken.updateMany({
      where: { userId, email: newEmail, usedAt: null },
      data: { usedAt: new Date() },
    })

    const { raw, hash } = generateVerificationToken()
    const expiresAt = new Date(
      Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    )
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        email: newEmail,
        tokenHash: hash,
        expiresAt,
      },
    })

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const verificationUrl = `${appUrl}/api/auth/verify-email?token=${raw}`

    const { subject, html, text } = renderVerificationEmail({
      recipientName: user.fullName,
      verificationUrl,
      expiresInHours: VERIFICATION_TTL_HOURS,
    })

    // Fire-and-forget — if Resend is down, the user can retry from the UI
    // via the resend-verification flow.
    sendEmail({ to: newEmail, subject, html, text }).catch((err) => {
      console.error('[account/change-email] email dispatch failed', err)
    })

    await prisma.authEvent.create({
      data: {
        userId,
        event: 'EMAIL_CHANGE_INITIATED',
        metadata: { newEmail, identifierId },
      },
    })

    return NextResponse.json({ sent: true, newEmail })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[account/change-email]', error)
    return NextResponse.json(
      { error: 'Unable to start email change' },
      { status: 500 },
    )
  }
}
