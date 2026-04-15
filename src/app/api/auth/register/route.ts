import { NextResponse } from 'next/server'
import { registerUser } from '@/lib/auth'
import { setSessionCookie } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { generateVerificationToken } from '@/lib/auth/tokens'
import { validatePasswordComplexity } from '@/lib/auth/password'
import { sendEmail, renderVerificationEmail } from '@/lib/email'

const VERIFICATION_TTL_HOURS = 24

export async function POST(request: Request) {
  let body: { fullName?: string; email?: string; password?: string; referralCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { fullName, email, password, referralCode } = body

  if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  const pwCheck = validatePasswordComplexity(password)
  if (!pwCheck.ok) {
    return NextResponse.json({ error: pwCheck.error }, { status: 400 })
  }

  try {
    const { user, session } = await registerUser({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      password,
      referralCode: referralCode || undefined,
    })

    // Fire-and-forget verification email. Signup has already succeeded — if
    // Resend is down or the token write fails, the user can use
    // /api/auth/resend-verification later. We deliberately do NOT await or let
    // a send failure reject the 201 response.
    const normalizedEmail = email.trim().toLowerCase()
    sendVerificationEmail(user.id, user.fullName, normalizedEmail).catch((err) => {
      console.error('[auth/register] verification email dispatch failed', err)
    })

    const response = NextResponse.json(
      { user: { id: user.id, fullName: user.fullName, email: normalizedEmail } },
      { status: 201 },
    )
    response.headers.set('Set-Cookie', setSessionCookie(session.token))
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed'
    if (message === 'Email already registered') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

async function sendVerificationEmail(userId: string, fullName: string, email: string) {
  const { raw, hash } = generateVerificationToken()
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000)

  await prisma.emailVerificationToken.create({
    data: { userId, email, tokenHash: hash, expiresAt },
  })

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  const verificationUrl = `${appUrl}/api/auth/verify-email?token=${raw}`

  const { subject, html, text } = renderVerificationEmail({
    recipientName: fullName,
    verificationUrl,
    expiresInHours: VERIFICATION_TTL_HOURS,
  })

  await sendEmail({ to: email, subject, html, text })
}
