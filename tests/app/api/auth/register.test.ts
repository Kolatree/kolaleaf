import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/register/route'

vi.mock('@/lib/auth', () => ({
  registerUser: vi.fn(),
}))

vi.mock('@/lib/auth/middleware', () => ({
  setSessionCookie: vi.fn(() => 'kolaleaf_session=mock; HttpOnly'),
}))

import { registerUser } from '@/lib/auth'

const mockRegister = vi.mocked(registerUser)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Complies with the production password policy:
  // 8+ chars, 3 of 4 character classes.
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

  it('returns 201 on successful registration', async () => {
    mockRegister.mockResolvedValue({
      user: { id: 'u1', fullName: 'Test User' } as never,
      session: { token: 'tok123' } as never,
    })

    const res = await POST(makeRequest({ fullName: 'Test User', email: 'a@b.com', password: VALID_PW }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.user.id).toBe('u1')
    expect(res.headers.get('Set-Cookie')).toContain('kolaleaf_session')
  })

  it('returns 409 for duplicate email', async () => {
    mockRegister.mockRejectedValue(new Error('Email already registered'))

    const res = await POST(makeRequest({ fullName: 'Test', email: 'dup@b.com', password: VALID_PW }))
    expect(res.status).toBe(409)
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
