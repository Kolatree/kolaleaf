import { describe, it, expect, vi } from 'vitest'

// Smoke test the four boundaries of the v1 move without standing up a dev
// server: import the route handler modules directly (same pattern the other
// e2e tests use). This proves:
//   - the v1 path resolves (module exists)
//   - the legacy path is gone (import throws)
//   - the /api/auth/register 410 stub is preserved at its legacy URL
//   - webhook routes are untouched under /api/webhooks/*

// Avoid collateral side effects from the verify-first pipeline — we only
// care about status codes here, not the email/DB behaviour.
vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/auth/pending-email-verification', () => ({
  issuePendingEmailCode: vi.fn().mockResolvedValue({ ok: true, delivered: true }),
}))

describe('Step 19 versioning smoke', () => {
  it('POST /api/v1/auth/send-code → 200', async () => {
    const mod = await import('@/app/api/v1/auth/send-code/route')
    const req = new Request('http://localhost/api/v1/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoke@test.com' }),
    })
    const res = await mod.POST(req)
    expect(res.status).toBe(200)
  })

  it('legacy /api/auth/send-code is gone (module does not exist)', async () => {
    // Dynamic import via a variable expression so tsc does not statically
    // resolve the path — we intentionally assert the module is absent.
    const legacyPath = '@/app/api/auth/send-code/route'
    await expect(import(/* @vite-ignore */ legacyPath)).rejects.toBeTruthy()
  })

  it('POST /api/auth/register still returns 410 (stub preserved at legacy path)', async () => {
    const mod = await import('@/app/api/auth/register/route')
    const res = await mod.POST()
    expect(res.status).toBe(410)
  })

  it('webhook route is still under /api/webhooks/monoova (not moved to v1)', async () => {
    // v1 path should NOT resolve (dynamic import via variable to skip tsc resolution)
    const v1WebhookPath = '@/app/api/v1/webhooks/monoova/route'
    await expect(import(/* @vite-ignore */ v1WebhookPath)).rejects.toBeTruthy()
    // legacy path still does
    const mod = await import('@/app/api/webhooks/monoova/route')
    expect(typeof mod.POST).toBe('function')
  })
})
