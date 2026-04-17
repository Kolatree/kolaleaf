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
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawEmail = body.email
  if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
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

  try {
    // Result is intentionally discarded. `issuePendingEmailCode` may
    // return `{ ok: false, reason: 'rate_limited' }` — we do NOT
    // surface that to the client because a 429 would leak enumeration
    // signal (attacker probes many emails, sees which ones return 429
    // = "that email is being registered right now"). All outcomes map
    // to the same 200 response; rate-limit failures are captured in
    // the DB counter + logs.
    await issuePendingEmailCode({ email })
  } catch (err) {
    console.error('[auth/send-code] issue failed', err)
    // Intentional: still return 200. Failure is captured in logs.
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
