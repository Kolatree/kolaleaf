import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { setSessionCookie } from '@/lib/auth/middleware'
import { createSession } from '@/lib/auth/sessions'
import { verifyEmailWithCode } from '@/lib/auth/email-verification'
import { logAuthEvent } from '@/lib/auth/audit'
import { getClientIp } from '@/lib/http/ip'
import { parseBody } from '@/lib/http/validate'
import { VerifyEmailBody } from './_schemas'

// POST /api/v1/auth/verify-email
//
// Body: { email: string, code: string }
//
// Validates a 6-digit verification code, marks the email identifier as
// verified, and (only on success) issues a session cookie. This is the
// gate that turns a dormant just-registered account into a usable one,
// and it is also the only way an unverified account can log in (the
// /api/v1/auth/login route returns `requiresVerification: true` for them
// and triggers a fresh code).
export async function POST(request: Request) {
  const parsed = await parseBody(request, VerifyEmailBody)
  if (!parsed.ok) return parsed.response
  const { email, code } = parsed.data

  const ip = getClientIp(request)
  const userAgent = request.headers.get('user-agent') ?? undefined

  const result = await verifyEmailWithCode({ email, code })

  if (!result.ok) {
    const status = result.reason === 'too_many_attempts' ? 429 : 400
    const message = ((): string => {
      switch (result.reason) {
        case 'wrong_code':
          return 'Incorrect code'
        case 'expired':
          return 'Code expired. Please request a new one.'
        case 'used':
          return 'This code was already used. Please log in.'
        case 'too_many_attempts':
          return 'Too many wrong attempts. Please request a new code.'
        case 'no_token':
          return 'No verification in progress for this email. Please register or request a new code.'
      }
    })()
    return NextResponse.json({ error: message, reason: result.reason }, { status })
  }

  const session = await createSession(result.userId, ip, userAgent)
  await logAuthEvent({
    userId: result.userId,
    event: 'LOGIN',
    ip,
    metadata: { via: 'email-verification', email },
  })

  const user = await prisma.user.findUnique({ where: { id: result.userId } })

  const response = NextResponse.json(
    {
      ok: true,
      user: user ? { id: user.id, fullName: user.fullName } : { id: result.userId },
    },
    { status: 200 },
  )
  response.headers.set('Set-Cookie', setSessionCookie(session.token))
  return response
}

// GET preserved as a minimal stub for any links still in users' inboxes
// from before the code-based flow shipped — redirects them to the login
// page with a hint to enter the code from a fresh email.
export async function GET(): Promise<Response> {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Use the code instead</title>` +
      `<meta http-equiv="refresh" content="0;url=/login">`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}
