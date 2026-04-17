import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/v1/auth/login/route'
import { EmailNotVerifiedError } from '@/lib/auth/login'

vi.mock('@/lib/auth/login', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/login')>()
  return {
    ...actual,
    loginUser: vi.fn(),
  }
})

vi.mock('@/lib/auth/middleware', () => ({
  setSessionCookie: vi.fn(() => 'kolaleaf_session=mock; HttpOnly'),
}))

vi.mock('@/lib/auth/email-verification', () => ({
  issueVerificationCode: vi.fn(async () => ({ ok: true })),
}))

import { loginUser } from '@/lib/auth/login'
import { issueVerificationCode } from '@/lib/auth/email-verification'

const mockLogin = vi.mocked(loginUser)
const mockIssue = vi.mocked(issueVerificationCode)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIssue.mockResolvedValue({ ok: true })
  })

  it('returns 400 for missing identifier', async () => {
    const res = await POST(makeRequest({ password: '12345678' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing password', async () => {
    const res = await POST(makeRequest({ identifier: 'a@b.com' }))
    expect(res.status).toBe(400)
  })

  it('returns user data on successful login', async () => {
    mockLogin.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test' } as never,
      session: { token: 'tok' } as never,
      requires2FA: false,
      twoFactorMethod: 'NONE',
    })

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: 'TestPass123!' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.user.id).toBe('u1')
    expect(json.requires2FA).toBe(false)
    expect(res.headers.get('Set-Cookie')).toContain('kolaleaf_session')
  })

  it('returns requires2FA true when user has TOTP enabled', async () => {
    mockLogin.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test' } as never,
      session: { token: 'tok' } as never,
      requires2FA: true,
      twoFactorMethod: 'TOTP',
    })

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: 'TestPass123!' }))
    const json = await res.json()
    expect(json.requires2FA).toBe(true)
  })

  it('returns 401 for invalid credentials', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'))

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: 'wrong' }))
    expect(res.status).toBe(401)
  })

  it('returns 202 with requiresVerification when email is unverified', async () => {
    mockLogin.mockRejectedValue(
      new EmailNotVerifiedError({ userId: 'u1', email: 'a@b.com', fullName: 'Test User' }),
    )

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: 'TestPass123!' }))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.requiresVerification).toBe(true)
    expect(json.email).toBe('a@b.com')
    // Critical: no session cookie issued — caller must verify first.
    expect(res.headers.get('Set-Cookie')).toBeNull()
    // A fresh code should have been triggered.
    expect(mockIssue).toHaveBeenCalledWith({
      userId: 'u1',
      email: 'a@b.com',
      recipientName: 'Test User',
    })
  })

  it('still returns 202 with requiresVerification even if code dispatch fails', async () => {
    mockLogin.mockRejectedValue(
      new EmailNotVerifiedError({ userId: 'u1', email: 'a@b.com', fullName: 'Test' }),
    )
    mockIssue.mockRejectedValueOnce(new Error('Resend down'))

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: 'TestPass123!' }))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.requiresVerification).toBe(true)
  })
})
