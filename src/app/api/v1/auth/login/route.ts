import { NextResponse } from 'next/server'
import { loginUser, EmailNotVerifiedError } from '@/lib/auth/login'
import {
  clearPendingTwoFactorCookie,
  clearSessionCookie,
  setPendingTwoFactorCookie,
  setSessionCookie,
} from '@/lib/auth/middleware'
import { issueVerificationCode } from '@/lib/auth/email-verification'
import { extractRequestContext } from '@/lib/security/request-context'
import { parseBody } from '@/lib/http/validate'
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  recordLoginFailure,
} from '@/lib/auth/login-rate-limit'
import { log } from '@/lib/obs/logger'
import { LoginBody } from './_schemas'

export async function POST(request: Request) {
  const parsed = await parseBody(request, LoginBody)
  if (!parsed.ok) return parsed.response
  const { identifier, password } = parsed.data

  const securityContext = extractRequestContext(request)
  const { ip, userAgent } = securityContext
  const identifierValue = identifier.value

  const rateLimit = checkLoginRateLimit(identifierValue, ip)
  if (!rateLimit.allowed) {
    log('warn', 'auth.login.rate_limited', {
      identifier: identifierValue,
      ip,
      retryAfterMs: rateLimit.retryAfterMs,
    })
    return NextResponse.json(
      {
        error: 'rate_limited',
        retryAfter: Math.ceil(rateLimit.retryAfterMs / 1000),
      },
      { status: 429 },
    )
  }

  try {
    // Email is already trimmed + lowercased by the Email primitive in
    // common.ts, so identifier.value arrives normalised.
    const { user, session, requires2FA, twoFactorMethod, challengeId } = await loginUser({
      identifier: identifierValue,
      password,
      ip,
      userAgent,
      securityContext,
    })
    clearLoginRateLimit(identifierValue, ip)

    const response = NextResponse.json({
      user: { id: user.id, fullName: user.fullName },
      requires2FA,
      twoFactorMethod,
    })
    response.headers.append('Set-Cookie', clearSessionCookie())
    if (requires2FA && challengeId) {
      response.headers.append('Set-Cookie', setPendingTwoFactorCookie(challengeId))
    } else if (session) {
      response.headers.append('Set-Cookie', clearPendingTwoFactorCookie())
      response.headers.append('Set-Cookie', setSessionCookie(session.token))
    }
    return response
  } catch (error) {
    if (error instanceof EmailNotVerifiedError) {
      clearLoginRateLimit(identifierValue, ip)
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

    if (error instanceof Error && error.message === 'Invalid credentials') {
      recordLoginFailure(identifierValue, ip)
    }

    // Never leak the underlying error to the client — a DB error or internal
    // failure would otherwise surface in the HTTP body. Log the raw error so
    // operators can debug, and respond with a uniform "Login failed".
    console.error('[auth/login]', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 401 })
  }
}
