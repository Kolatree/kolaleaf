import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { issuePendingEmailCode } from '@/lib/auth/pending-email-verification'

// POST /api/auth/send-code
//
// Body: { email: string }
//
// Step 1 of the verify-first registration wizard. Issues a 6-digit
// verification code to the target email so the user can prove control
// before any User row is created. No account exists yet at this point —
// the PendingEmailVerification row is keyed by email alone.
//
// Enumeration-proof: this endpoint ALWAYS returns 200 `{ ok: true }`
// regardless of whether:
//   - the email is malformed-but-present (hard 400 guard aside)
//   - the email belongs to an already-verified user (no code sent)
//   - the email is free (code sent)
//   - the issuer is rate-limited or Resend is down (no code sent)
//
// The single 400 branch is a malformed-or-missing email string — that's a
// client-side bug, not an enumeration signal, so it's safe to surface.
export async function POST(request: Request) {
  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON', reason: 'invalid_json' },
      { status: 400 },
    )
  }

  const rawEmail = body.email
  if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
    return NextResponse.json(
      { error: 'Email is required', reason: 'missing_email' },
      { status: 400 },
    )
  }

  const email = rawEmail.trim().toLowerCase()

  // Never send a code to an already-verified-and-owned email. This keeps
  // duplicate-email fraud attempts from quietly stealing an in-flight
  // verification slot (and stops us acting as an enumeration oracle by
  // sending the real user a spurious code).
  const existing = await prisma.userIdentifier.findUnique({
    where: { identifier: email },
  })
  if (existing && existing.type === 'EMAIL' && existing.verified) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Result branches:
  //   ok: true                     → code dispatched
  //   reason: 'rate_limited'       → cap hit, silently no-op
  //   reason: 'claim_in_flight'    → legit user mid-wizard, no-op to
  //                                   preserve their verified claim
  //   reason: 'send_failed'        → Resend rejected / errored
  //   (throws)                     → unexpected failure
  // All branches map to the same 200 response for enumeration safety;
  // we log structurally so ops can alert on rate_limited / send_failed
  // without surfacing state to the client.
  try {
    const result = await issuePendingEmailCode({ email })
    if (!result.ok) {
      console.error(
        JSON.stringify({
          level: 'warn',
          route: 'auth/send-code',
          reason: result.reason,
          emailHash: await sha256Hex(email),
          ts: new Date().toISOString(),
          ...('providerError' in result ? { providerError: result.providerError } : {}),
          ...('retryAfterMs' in result ? { retryAfterMs: result.retryAfterMs } : {}),
        }),
      )
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        route: 'auth/send-code',
        reason: 'unexpected',
        emailHash: await sha256Hex(email),
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    )
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

// Hash the email so ops logs don't become a PII reservoir. sha256 is
// reversible via rainbow tables against a known corpus of target emails,
// so this is obfuscation for log-retention purposes, not a secrecy
// guarantee. Full email stays in the DB where it belongs.
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
