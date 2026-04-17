import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { issuePendingEmailCode } from '@/lib/auth/pending-email-verification'
import { parseBody } from '@/lib/http/validate'
import { SendCodeBody } from './_schemas'

// POST /api/v1/auth/send-code
//
// Step 1 of the verify-first wizard: issue a 6-digit code to the target
// email. Enumeration-proof: ALWAYS 200 regardless of whether the email
// is known/free/rate-limited. The only non-2xx paths are schema failure
// (422 via Zod) and malformed JSON (400).
//
// Resend runs fire-and-forget after the route has returned — on Railway
// (Node, not serverless) the promise completes even after the response
// flushes. This removes the 300–800ms Resend round-trip from the request
// path while preserving the "always 200" contract.
export async function POST(request: Request) {
  const parsed = await parseBody(request, SendCodeBody)
  if (!parsed.ok) return parsed.response
  const { email } = parsed.data

  // Short-circuit for already-verified-and-owned emails. Prevents a
  // duplicate-email fraud attempt from stealing a verification slot
  // AND stops us acting as an enumeration oracle by sending the real
  // user a spurious code.
  const existing = await prisma.userIdentifier.findUnique({
    where: { identifier: email },
  })
  if (existing && existing.type === 'EMAIL' && existing.verified) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Fire-and-forget. Response goes out immediately; the helper runs to
  // completion in the background. Structured logs surface
  // rate_limited / send_failed / unexpected without leaking state to
  // the client.
  issuePendingEmailCode({ email })
    .then(async (result) => {
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
    })
    .catch(async (err) => {
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
    })

  return NextResponse.json({ ok: true }, { status: 200 })
}

// Hash the email for log correlation without persisting raw PII in
// log storage. Reversible via rainbow tables against a known target
// list, so this is log-hygiene, not a secrecy guarantee.
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
