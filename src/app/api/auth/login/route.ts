import { NextResponse } from 'next/server'
import { loginUser, EmailNotVerifiedError } from '@/lib/auth/login'
import { setSessionCookie } from '@/lib/auth/middleware'
import { issueVerificationCode } from '@/lib/auth/email-verification'
import { getClientIp } from '@/lib/http/ip'

export async function POST(request: Request) {
  let body: { identifier?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { identifier, password } = body

  if (!identifier || typeof identifier !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }

  const ip = getClientIp(request)
  const userAgent = request.headers.get('user-agent') ?? undefined

  try {
    const { user, session, requires2FA } = await loginUser({
      identifier: identifier.trim().toLowerCase(),
      password,
      ip,
      userAgent,
    })

    const response = NextResponse.json({
      user: { id: user.id, fullName: user.fullName },
      requires2FA,
    })
    response.headers.set('Set-Cookie', setSessionCookie(session.token))
    return response
  } catch (error) {
    if (error instanceof EmailNotVerifiedError) {
      // Password was correct but the email is unverified. Issue a fresh code
      // (best-effort: rate limit may suppress) and tell the client to bounce
      // to /verify-email. We do NOT set a session cookie.
      try {
        await issueVerificationCode({
          userId: error.userId,
          email: error.email,
          recipientName: error.fullName,
        })
      } catch (issueErr) {
        console.error('[auth/login] verification code issue failed', issueErr)
        // Continue — surface the verification-required state to the client
        // anyway; the user can hit "resend" from the verify page.
      }
      return NextResponse.json(
        {
          requiresVerification: true,
          email: error.email,
          message: 'Please verify your email to continue',
        },
        { status: 202 },
      )
    }

    // Never leak the underlying error to the client — a DB error or internal
    // failure would otherwise surface in the HTTP body. Log the raw error so
    // operators can debug, and respond with a uniform "Login failed".
    console.error('[auth/login]', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 401 })
  }
}
