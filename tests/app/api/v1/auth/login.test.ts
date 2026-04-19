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
  setPendingTwoFactorCookie: vi.fn(() => 'kolaleaf_pending_2fa=challenge; HttpOnly'),
  clearPendingTwoFactorCookie: vi.fn(() => 'kolaleaf_pending_2fa=; Max-Age=0'),
  clearSessionCookie: vi.fn(() => 'kolaleaf_session=; Max-Age=0'),
}))

vi.mock('@/lib/auth/email-verification', () => ({
  issueVerificationCode: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/auth/login-rate-limit', () => ({
  checkLoginRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  clearLoginRateLimit: vi.fn(),
  recordLoginFailure: vi.fn(),
}))

import { loginUser } from '@/lib/auth/login'
import { issueVerificationCode } from '@/lib/auth/email-verification'
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  recordLoginFailure,
} from '@/lib/auth/login-rate-limit'

const mockLogin = vi.mocked(loginUser)
const mockIssue = vi.mocked(issueVerificationCode)
const mockCheckRateLimit = vi.mocked(checkLoginRateLimit)
const mockClearRateLimit = vi.mocked(clearLoginRateLimit)
const mockRecordFailure = vi.mocked(recordLoginFailure)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Step 21: identifier is now a discriminated union, email-only today.
const validBody = (email = 'a@b.com', password = 'TestPass123!') => ({
  identifier: { type: 'email', value: email },
  password,
})

describe('POST /api/v1/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIssue.mockResolvedValue({ ok: true })
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  })

  it('returns 422 for missing identifier (Zod)', async () => {
    const res = await POST(makeRequest({ password: '12345678' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.reason).toBe('validation_failed')
    expect(json.fields?.identifier).toBeInstanceOf(Array)
  })

  it('returns 422 for missing password (Zod)', async () => {
    const res = await POST(
      makeRequest({ identifier: { type: 'email', value: 'a@b.com' } }),
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.password).toBeInstanceOf(Array)
  })

  it('returns 422 for legacy bare-string identifier (Step 21 contract)', async () => {
    const res = await POST(makeRequest({ identifier: 'a@b.com', password: 'x' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 for malformed email inside the union', async () => {
    const res = await POST(
      makeRequest({
        identifier: { type: 'email', value: 'not-an-email' },
        password: 'x',
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 for unsupported identifier type', async () => {
    // Only type: 'email' is implemented today; schema narrows there.
    const res = await POST(
      makeRequest({
        identifier: { type: 'google', value: 'tok' },
        password: 'x',
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 400 malformed_json on invalid JSON', async () => {
    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns user data on successful login', async () => {
    mockLogin.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test' } as never,
      session: { token: 'tok' } as never,
      requires2FA: false,
      twoFactorMethod: 'NONE',
    })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.user.id).toBe('u1')
    expect(json.requires2FA).toBe(false)
    expect(res.headers.get('Set-Cookie')).toContain('kolaleaf_session')
  })

  it('passes the normalised email (identifier.value) into loginUser', async () => {
    mockLogin.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test' } as never,
      session: { token: 'tok' } as never,
      requires2FA: false,
      twoFactorMethod: 'NONE',
    })
    await POST(makeRequest(validBody('  A@B.COM  ')))
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'a@b.com' }),
    )
  })

  it('returns requires2FA true when user has TOTP enabled', async () => {
    mockLogin.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test' } as never,
      requires2FA: true,
      twoFactorMethod: 'TOTP',
      challengeId: 'challenge-1',
    })

    const res = await POST(makeRequest(validBody()))
    const json = await res.json()
    expect(json.requires2FA).toBe(true)
    expect(json.twoFactorMethod).toBe('TOTP')
    expect(res.headers.get('Set-Cookie')).toContain('kolaleaf_pending_2fa')
  })

  it('returns 401 for invalid credentials', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'))

    const res = await POST(makeRequest(validBody('a@b.com', 'wrong')))
    expect(res.status).toBe(401)
    expect(mockRecordFailure).toHaveBeenCalledWith('a@b.com', undefined)
  })

  it('returns 429 when login rate limit is exceeded', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 30_000 })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error).toBe('rate_limited')
    expect(json.retryAfter).toBe(30)
    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('returns 202 with requiresVerification when email is unverified', async () => {
    mockLogin.mockRejectedValue(
      new EmailNotVerifiedError({ userId: 'u1', email: 'a@b.com', fullName: 'Test User' }),
    )

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.requiresVerification).toBe(true)
    expect(json.email).toBe('a@b.com')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(mockClearRateLimit).toHaveBeenCalledWith('a@b.com', undefined)
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

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.requiresVerification).toBe(true)
  })
})
