import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/pending-email-verification', () => ({
  issuePendingEmailCode: vi.fn(),
}))

import { POST } from '@/app/api/auth/send-code/route'
import { prisma } from '@/lib/db/client'
import { issuePendingEmailCode } from '@/lib/auth/pending-email-verification'

const mockIdentFind = vi.mocked(prisma.userIdentifier.findUnique)
const mockIssue = vi.mocked(issuePendingEmailCode)

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/send-code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIssue.mockResolvedValue({ ok: true, delivered: true })
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/auth/send-code', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is missing or malformed', async () => {
    const a = await POST(postRequest({}))
    expect(a.status).toBe(400)
    const b = await POST(postRequest({ email: 'notanemail' }))
    expect(b.status).toBe(400)
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('returns 200 and does NOT issue a code when email is owned by a verified user (enumeration-proof)', async () => {
    mockIdentFind.mockResolvedValueOnce({
      id: 'id1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'taken@b.com',
      verified: true,
    } as never)

    const res = await POST(postRequest({ email: 'taken@b.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('issues a code when email is free (no identifier at all)', async () => {
    mockIdentFind.mockResolvedValueOnce(null)

    const res = await POST(postRequest({ email: 'new@b.com' }))
    expect(res.status).toBe(200)
    expect(mockIssue).toHaveBeenCalledWith({ email: 'new@b.com' })
  })

  it('issues a code when the email exists only as an UNverified identifier', async () => {
    // An existing-but-unverified UserIdentifier is a legacy shape; the new
    // flow does not create User rows pre-verification, so this branch is
    // mostly for pre-existing rows. We still allow a fresh pending code to
    // go out so the user can complete the wizard.
    mockIdentFind.mockResolvedValueOnce({
      id: 'id1',
      userId: 'u-legacy',
      type: 'EMAIL',
      identifier: 'legacy@b.com',
      verified: false,
    } as never)

    const res = await POST(postRequest({ email: 'legacy@b.com' }))
    expect(res.status).toBe(200)
    expect(mockIssue).toHaveBeenCalledWith({ email: 'legacy@b.com' })
  })

  it('normalises email casing and whitespace before lookup and issue', async () => {
    mockIdentFind.mockResolvedValueOnce(null)
    await POST(postRequest({ email: '  A@B.COM  ' }))
    expect(mockIdentFind).toHaveBeenCalledWith({ where: { identifier: 'a@b.com' } })
    expect(mockIssue).toHaveBeenCalledWith({ email: 'a@b.com' })
  })

  it('still returns 200 when the issuer is rate-limited (never leaks state)', async () => {
    mockIdentFind.mockResolvedValueOnce(null)
    mockIssue.mockResolvedValueOnce({
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 3_600_000,
    })

    const res = await POST(postRequest({ email: 'ratelimited@b.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('still returns 200 when the issuer throws (Resend down) — failure is logged, not surfaced', async () => {
    mockIdentFind.mockResolvedValueOnce(null)
    mockIssue.mockRejectedValueOnce(new Error('Resend outage'))

    const res = await POST(postRequest({ email: 'down@b.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })
})
