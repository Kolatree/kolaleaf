import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { generateVerificationToken } from '@/lib/auth/tokens'
import { sendEmail, renderPasswordResetEmail } from '@/lib/email'
import { getClientIp } from '@/lib/http/ip'

const RESET_TTL_MINUTES = 60
const RATE_LIMIT_PER_HOUR = 3

const GENERIC_MESSAGE =
  "If an account exists with that email, we've sent a reset link."

/**
 * POST /api/auth/request-password-reset { email }
 *
 * Always returns the same generic 200 response regardless of whether the email
 * exists — prevents email enumeration. The rate-limit is silent for the same
 * reason: the attacker never learns anything from the response body.
 */
export async function POST(request: Request) {
  let body: { email?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }
  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }

  const ip = getClientIp(request)
  const userAgent = request.headers.get('user-agent') ?? undefined

  try {
    const ident = await prisma.userIdentifier.findUnique({
      where: { identifier: email },
      include: { user: true },
    })

    // No account: respond generically without sending anything.
    if (!ident || ident.type !== 'EMAIL' || !ident.user) {
      return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 })
    }

    const userId = ident.user.id

    // Silent rate limit — preserve the generic response either way.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recent = await prisma.passwordResetToken.count({
      where: { userId, createdAt: { gte: oneHourAgo } },
    })
    if (recent >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 })
    }

    // Invalidate outstanding unused reset tokens.
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    })

    const { raw, hash } = generateVerificationToken()
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000)

    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hash,
        expiresAt,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    })

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const resetUrl = `${appUrl}/reset-password?token=${raw}`

    const { subject, html, text } = renderPasswordResetEmail({
      recipientName: ident.user.fullName,
      resetUrl,
      expiresInMinutes: RESET_TTL_MINUTES,
      ip,
      userAgent,
    })

    await sendEmail({ to: email, subject, html, text })

    return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 })
  } catch (error) {
    console.error('[auth/request-password-reset]', error)
    // Even on internal error, keep the response shape identical. Surfacing a
    // different error here would let an attacker probe for specific accounts.
    return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 })
  }
}
