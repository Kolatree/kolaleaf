import { prisma } from '@/lib/db/client'
import { hashToken } from '@/lib/auth/tokens'

/**
 * GET /api/auth/verify-email?token=<raw>
 *
 * Public one-shot page. Renders minimal HTML (not part of the Variant D shell).
 * All failure modes collapse into a single generic "expired or already used"
 * page — we don't reveal whether a token never existed vs. was consumed.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const raw = url.searchParams.get('token')

  if (!raw || raw.length === 0) {
    return htmlResponse(expiredPage(), 400)
  }

  const tokenHash = hashToken(raw)
  const token = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } })

  if (!token || token.usedAt !== null || token.expiresAt < new Date()) {
    return htmlResponse(expiredPage(), 400)
  }

  // Flip the identifier first so we can detect a stale token (identifier
  // deleted or re-created after the token was issued) via a zero-row result.
  const updated = await prisma.userIdentifier.updateMany({
    where: { userId: token.userId, type: 'EMAIL', identifier: token.email },
    data: { verified: true, verifiedAt: new Date() },
  })

  if (updated.count === 0) {
    // Identifier referenced by the token no longer exists. Leave the token
    // unused (it'll expire on its own) and render the generic expired page —
    // we don't want to leak that the identifier itself has gone away.
    return htmlResponse(expiredPage(), 400)
  }

  await prisma.emailVerificationToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  })

  // Immutable audit log per CLAUDE.md — every auth state transition is logged.
  await prisma.authEvent.create({
    data: {
      userId: token.userId,
      event: 'EMAIL_VERIFIED',
      metadata: { identifier: token.email, via: 'verify-email-link' },
    },
  })

  return htmlResponse(successPage(), 200)
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function page(title: string, heading: string, body: string, link: { href: string; label: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f7fb;color:#1a1a2e;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px; }
      .card { max-width:440px;width:100%;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);overflow:hidden; }
      .header { padding:24px 32px;background:linear-gradient(90deg,#6d4aff 0%,#1aa85a 100%);color:#fff;font-weight:600; }
      .body { padding:28px 32px; }
      h1 { margin:0 0 12px 0;font-size:20px; }
      p { margin:0 0 20px 0;color:#4a4a68;line-height:1.5; }
      a.btn { display:inline-block;background:#6d4aff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">Kolaleaf</div>
      <div class="body">
        <h1>${heading}</h1>
        <p>${body}</p>
        <a class="btn" href="${link.href}">${link.label}</a>
      </div>
    </div>
  </body>
</html>`
}

function successPage(): string {
  return page(
    'Email verified — Kolaleaf',
    'Email verified',
    'Your email is verified. You can now send money on Kolaleaf.',
    { href: '/', label: 'Continue to your account' },
  )
}

function expiredPage(): string {
  return page(
    'Link expired — Kolaleaf',
    'Link expired or already used',
    'This verification link is no longer valid. Sign in and request a new one from your account.',
    { href: '/login', label: 'Request a new verification link' },
  )
}
