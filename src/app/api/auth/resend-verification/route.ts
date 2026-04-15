import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { generateVerificationToken } from '@/lib/auth/tokens'
import { sendEmail, renderVerificationEmail } from '@/lib/email'

const VERIFICATION_TTL_HOURS = 24
const RATE_LIMIT_PER_HOUR = 5

export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)

    const emailId = await prisma.userIdentifier.findFirst({
      where: { userId, type: 'EMAIL' },
      orderBy: { createdAt: 'asc' },
    })

    if (!emailId) {
      return NextResponse.json({ error: 'No email on file' }, { status: 404 })
    }

    if (emailId.verified) {
      return NextResponse.json({ alreadyVerified: true }, { status: 200 })
    }

    // Rate limit: max N tokens created per user in the last hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recent = await prisma.emailVerificationToken.count({
      where: { userId, createdAt: { gte: oneHourAgo } },
    })
    if (recent >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: 'Too many requests. Try again later.' },
        { status: 429 },
      )
    }

    // Invalidate any outstanding unused tokens for this user+email.
    await prisma.emailVerificationToken.updateMany({
      where: { userId, email: emailId.identifier, usedAt: null },
      data: { usedAt: new Date() },
    })

    const { raw, hash } = generateVerificationToken()
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000)

    await prisma.emailVerificationToken.create({
      data: {
        userId,
        email: emailId.identifier,
        tokenHash: hash,
        expiresAt,
      },
    })

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const verificationUrl = `${appUrl}/api/auth/verify-email?token=${raw}`

    // Look up user for a friendly greeting; fall back to "there" if missing.
    const user = await prisma.user.findUnique({ where: { id: userId } })
    const { subject, html, text } = renderVerificationEmail({
      recipientName: user?.fullName ?? 'there',
      verificationUrl,
      expiresInHours: VERIFICATION_TTL_HOURS,
    })

    await sendEmail({ to: emailId.identifier, subject, html, text })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[auth/resend-verification]', error)
    return NextResponse.json({ error: 'Unable to resend verification' }, { status: 500 })
  }
}
