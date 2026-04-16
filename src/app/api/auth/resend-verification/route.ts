import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { issueVerificationCode } from '@/lib/auth/email-verification'

// POST /api/auth/resend-verification
//
// Body: { email: string }
//
// Public, unauthenticated endpoint — the calling user has no session yet
// (they're stuck on the /verify-email screen waiting for a code). To avoid
// becoming an enumeration oracle ("does this email exist?") we always
// return a 200 with the same shape, regardless of whether:
//   - the email is unknown
//   - the email is known and verified (no code needed)
//   - the email is known and unverified (we send a code)
//   - the per-user resend rate limit fires
//
// Rate limiting per-user (5/hr) lives in `issueVerificationCode`.
// Network-level abuse should be rate-limited at the edge / WAF.
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

  const ident = await prisma.userIdentifier.findUnique({
    where: { identifier: email },
    include: { user: true },
  })

  // Always return ok:true — see preamble. Real failures are logged for ops.
  if (!ident || ident.type !== 'EMAIL' || ident.verified) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    await issueVerificationCode({
      userId: ident.userId,
      email: ident.identifier,
      recipientName: ident.user.fullName,
    })
  } catch (err) {
    console.error('[auth/resend-verification] issue failed', err)
    // Still return 200 — see preamble. The failure is captured in logs.
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
