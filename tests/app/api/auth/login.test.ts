import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/login/route'

vi.mock('@/lib/auth', () => ({
  loginUser: vi.fn(),
}))

vi.mock('@/lib/auth/middleware', () => ({
  setSessionCookie: vi.fn(() => 'kolaleaf_session=mock; HttpOnly'),
}))

import { loginUser } from '@/lib/auth'

const mockLogin = vi.mocked(loginUser)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    })

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: '12345678' }))
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
    })

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: '12345678' }))
    const json = await res.json()
    expect(json.requires2FA).toBe(true)
  })

  it('returns 401 for invalid credentials', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'))

    const res = await POST(makeRequest({ identifier: 'a@b.com', password: 'wrong' }))
    expect(res.status).toBe(401)
  })
})
