import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  clearSessionCookie: vi.fn(() => 'kolaleaf_session=; Max-Age=0'),
  AuthError: class extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg)
      this.name = 'AuthError'
      this.statusCode = statusCode
    }
  },
}))

vi.mock('@/lib/auth', () => ({
  revokeSession: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/v1/auth/logout/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

const mockRequireAuth = vi.mocked(requireAuth)

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 and clears the cookie on success', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('kolaleaf_session=')
  })

  it('returns 200 even when already unauthenticated (idempotent)', async () => {
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
  })
})
