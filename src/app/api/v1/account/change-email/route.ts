import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from '@/lib/auth/password'
import { issueVerificationCode } from '@/lib/auth/email-verification'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { parseBody } from '@/lib/http/validate'
import { ChangeEmailBody } from './_schemas'

// POST /api/account/change-email { currentPassword, newEmail }
//
// Starts the change-email flow. Requires the current password to prove intent.
// Creates an unverified UserIdentifier for the new email and sends a 6-digit
// verification code via the same path as registration / login. The user
// completes the change by POSTing the code to /api/auth/verify-email — the
// `verifyEmailWithCode` helper flips the identifier to verified.
//
// Leaves the old email in place until the user removes it via
// DELETE /api/account/email/[id], so the user cannot lock themselves out
// by fat-fingering the new address.
export async function POST(request: Request) {
  const parsed = await parseBody(request, ChangeEmailBody)
  if (!parsed.ok) return parsed.response
  const { currentPassword, newEmail } = parsed.data

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

    // Issue + send the 6-digit code. Helper handles invalidation of prior
    // unused tokens, attempts=0 on the new one, and the rate limit. Fire-
    // and-forget — if Resend is down, the user can retry from the UI via
    // /api/auth/resend-verification.
    issueVerificationCode({
      userId,
      email: newEmail,
      recipientName: user.fullName,
    }).catch((err) => {
      console.error('[account/change-email] code dispatch failed', err)
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
