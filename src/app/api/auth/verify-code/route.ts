import { NextResponse } from 'next/server'
import { verifyPendingEmailCode } from '@/lib/auth/pending-email-verification'

// POST /api/auth/verify-code
//
// Body: { email: string, code: string }
//
// Step 2 of the verify-first registration wizard. Validates the 6-digit
// code that /send-code emailed the user and, on success, opens a 30-min
// claim window during which the caller may POST /complete-registration
// to create the actual User row.
//
// Never issues a session. A session is only possible once
// /complete-registration succeeds and a User + UserIdentifier(verified)
// + Session are created atomically.
export async function POST(request: Request) {
  let body: { email?: string; code?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email: rawEmail, code: rawCode } = body
  if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }
  if (!rawCode || typeof rawCode !== 'string' || !/^\d{6}$/.test(rawCode)) {
    return NextResponse.json({ error: 'Code must be 6 digits' }, { status: 400 })
  }

  const email = rawEmail.trim().toLowerCase()
  const result = await verifyPendingEmailCode({ email, code: rawCode })

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
    return NextResponse.json({ error: message, reason: result.reason }, { status })
  }

  return NextResponse.json({ verified: true }, { status: 200 })
}
