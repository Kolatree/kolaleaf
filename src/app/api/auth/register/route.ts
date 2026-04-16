import { NextResponse } from 'next/server'
import { registerUser } from '@/lib/auth'
import { validatePasswordComplexity } from '@/lib/auth/password'
import { issueVerificationCode } from '@/lib/auth/email-verification'
import { prisma } from '@/lib/db/client'

// POST /api/auth/register
//
// Creates the user + identifier, then sends a 6-digit email verification
// code. Does NOT set a session cookie — the user must POST the code to
// /api/auth/verify-email to receive their session. This is the strict
// "verify-then-login" gate (see CLAUDE.md AUSTRAC notes — confirms the
// customer controls the email account before any privileged surface).
//
// Returns 202 Accepted because account creation succeeded but the
// account is dormant pending verification.
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

  const normalizedEmail = email.trim().toLowerCase()

  let userId: string
  let userName: string
  try {
    const { user } = await registerUser({
      fullName: fullName.trim(),
      email: normalizedEmail,
      password: pwCheck.password,
      referralCode: referralCode || undefined,
    })
    userId = user.id
    userName = user.fullName
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed'
    if (message === 'Email already registered') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Drop the just-created session — registerUser still issues one for callers
  // that want the legacy auto-login behaviour, but our flow rejects it. We
  // delete by userId rather than by the returned token so we don't leak
  // session shape across the verification boundary.
  await prisma.session.deleteMany({ where: { userId } })

  // Send verification code. If Resend errors, propagate so the client can
  // surface "we couldn't send the code, try again" — better than silently
  // creating a dormant account the user can never activate.
  try {
    await issueVerificationCode({
      userId,
      email: normalizedEmail,
      recipientName: userName,
    })
  } catch (err) {
    console.error('[auth/register] code issue failed', err)
    return NextResponse.json(
      { error: 'Account created but we could not send the verification code. Please try logging in to retry.' },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      requiresVerification: true,
      email: normalizedEmail,
      expiresInMinutes: 30,
    },
    { status: 202 },
  )
}
