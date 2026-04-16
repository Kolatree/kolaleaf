import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/auth/middleware', () => ({
  setSessionCookie: vi.fn(() => 'kolaleaf_session=mock; HttpOnly'),
}))

vi.mock('@/lib/auth/sessions', () => ({
  createSession: vi.fn(async () => ({ token: 'sess-tok' })),
}))

vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/auth/email-verification', () => ({
  verifyEmailWithCode: vi.fn(),
}))

import { POST, GET } from '@/app/api/auth/verify-email/route'
import { prisma } from '@/lib/db/client'
import { createSession } from '@/lib/auth/sessions'
import { logAuthEvent } from '@/lib/auth/audit'
import { verifyEmailWithCode } from '@/lib/auth/email-verification'

const mockVerify = vi.mocked(verifyEmailWithCode)
const mockCreateSession = vi.mocked(createSession)
const mockLogEvent = vi.mocked(logAuthEvent)
const mockUserFind = vi.mocked(prisma.user.findUnique)

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when email missing', async () => {
    const res = await POST(postRequest({ code: '123456' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when code missing', async () => {
    const res = await POST(postRequest({ email: 'a@b.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when code is not 6 digits', async () => {
    const res = await POST(postRequest({ email: 'a@b.com', code: '1234' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 with friendly message on wrong_code', async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: 'wrong_code' })
    const res = await POST(postRequest({ email: 'a@b.com', code: '111111' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/incorrect/i)
    expect(json.reason).toBe('wrong_code')
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('returns 400 on expired', async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: 'expired' })
    const res = await POST(postRequest({ email: 'a@b.com', code: '111111' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/expired/i)
  })

  it('returns 429 on too_many_attempts', async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: 'too_many_attempts' })
    const res = await POST(postRequest({ email: 'a@b.com', code: '111111' }))
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error).toMatch(/too many/i)
  })

  it('creates session and sets cookie on success', async () => {
    mockVerify.mockResolvedValueOnce({ ok: true, userId: 'u1' })
    mockUserFind.mockResolvedValueOnce({ id: 'u1', fullName: 'Test User' } as never)

    const res = await POST(postRequest({ email: 'a@b.com', code: '654321' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.user.id).toBe('u1')
    expect(json.user.fullName).toBe('Test User')
    expect(res.headers.get('Set-Cookie')).toContain('kolaleaf_session')
    expect(mockCreateSession).toHaveBeenCalledWith('u1', undefined, undefined)
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', event: 'LOGIN' }),
    )
  })

  it('normalizes email casing before passing to verifier', async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: 'no_token' })
    await POST(postRequest({ email: 'A@B.COM', code: '111111' }))
    expect(mockVerify).toHaveBeenCalledWith({ email: 'a@b.com', code: '111111' })
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://localhost/api/auth/verify-email', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/auth/verify-email (legacy magic-link redirect)', () => {
  it('returns HTML pointing users at /login', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const text = await res.text()
    expect(text).toMatch(/url=\/login/)
  })
})
