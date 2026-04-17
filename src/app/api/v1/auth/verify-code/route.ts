import { NextResponse } from 'next/server'
import { verifyPendingEmailCode } from '@/lib/auth/pending-email-verification'
import { jsonError } from '@/lib/http/json-error'
import { parseBody } from '@/lib/http/validate'
import { VerifyCodeBody } from './_schemas'

// POST /api/v1/auth/verify-code
//
// Step 2 of the verify-first wizard. Validates the 6-digit code emailed
// in step 1 and, on success, opens a 30-minute claim window during
// which /complete-registration may consume it. Never issues a session.
export async function POST(request: Request) {
  const parsed = await parseBody(request, VerifyCodeBody)
  if (!parsed.ok) return parsed.response
  const { email, code } = parsed.data

  const result = await verifyPendingEmailCode({ email, code })

  if (!result.ok) {
    const status = result.reason === 'too_many_attempts' ? 429 : 400
    const message = ((): string => {
      switch (result.reason) {
        case 'wrong_code':
          return 'Incorrect code'
        case 'expired':
          return 'Code expired. Please request a new one.'
        case 'used':
          return 'This code was already used. Please start over.'
        case 'too_many_attempts':
          return 'Too many wrong attempts. Please request a new code.'
        case 'no_token':
          return 'No verification in progress for this email. Please request a new code.'
      }
    })()
    // too_many_attempts is a burned-token state (not a time-based rate
    // limit), so Retry-After: 0 tells RFC-6585-conforming clients they
    // can hit /send-code immediately.
    const headers: Record<string, string> | undefined =
      status === 429 ? { 'Retry-After': '0' } : undefined
    return jsonError(result.reason, message, status, headers)
  }

  return NextResponse.json({ verified: true }, { status: 200 })
}
