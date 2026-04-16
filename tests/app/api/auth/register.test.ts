import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/register/route'

vi.mock('@/lib/auth', () => ({
  registerUser: vi.fn(),
}))

vi.mock('@/lib/auth/email-verification', () => ({
  issueVerificationCode: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    session: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}))

import { registerUser } from '@/lib/auth'
import { issueVerificationCode } from '@/lib/auth/email-verification'
import { prisma } from '@/lib/db/client'

const mockRegister = vi.mocked(registerUser)
const mockIssue = vi.mocked(issueVerificationCode)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/register (verify-then-login)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIssue.mockResolvedValue({ ok: true })
  })

  // Complies with the production password policy: 8+ chars, 3 of 4 char classes.
  const VALID_PW = 'TestPass123!'

  it('returns 400 for missing fullName', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com', password: VALID_PW }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Full name')
  })

  it('returns 400 for invalid email', async () => {
    const res = await POST(makeRequest({ fullName: 'Test', email: 'notanemail', password: VALID_PW }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('email')
  })

  it('returns 400 for short password', async () => {
    const res = await POST(makeRequest({ fullName: 'Test', email: 'a@b.com', password: '123' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/8 character|Password/)
  })

  it('returns 202 with requiresVerification on successful registration', async () => {
    mockRegister.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test User' } as never,
      session: { token: 'tok123' } as never,
    })

    const res = await POST(makeRequest({ fullName: 'Test User', email: 'a@b.com', password: VALID_PW }))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.requiresVerification).toBe(true)
    expect(json.email).toBe('a@b.com')
    // Critical: no session cookie. Account is dormant until /verify-email.
    expect(res.headers.get('Set-Cookie')).toBeNull()
    // The auto-issued session from registerUser must be deleted so it can't
    // be replayed via direct cookie injection.
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    // And the verification code must be issued.
    expect(mockIssue).toHaveBeenCalledWith({
      userId: 'u1',
      email: 'a@b.com',
      recipientName: 'Test User',
    })
  })

  it('returns 500 if code dispatch throws (account exists but unactivatable)', async () => {
    mockRegister.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test User' } as never,
      session: { token: 'tok123' } as never,
    })
    mockIssue.mockRejectedValueOnce(new Error('Resend down'))

    const res = await POST(makeRequest({ fullName: 'Test User', email: 'a@b.com', password: VALID_PW }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/verification code/i)
  })

  it('returns 409 for duplicate email', async () => {
    mockRegister.mockRejectedValue(new Error('Email already registered'))

    const res = await POST(makeRequest({ fullName: 'Test', email: 'dup@b.com', password: VALID_PW }))
    expect(res.status).toBe(409)
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid JSON')
  })
})
