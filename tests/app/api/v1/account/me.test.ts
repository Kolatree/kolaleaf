import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/v1/account/me is a response-only schema route — no body or
// query to validate. These tests confirm the handler still returns the
// expected shape (used as the OpenAPI 200 contract) and the auth gate
// behaves consistently after the Step 20 migration.
vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: { findUniqueOrThrow: vi.fn() },
    userIdentifier: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  AuthError: class extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg)
      this.name = 'AuthError'
      this.statusCode = statusCode
    }
  },
}))

import { GET } from '@/app/api/v1/account/me/route'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { AccountMeResponse } from '@/app/api/v1/account/me/_schemas'

const mockRequireAuth = vi.mocked(requireAuth)
const mockUser = vi.mocked(prisma.user.findUniqueOrThrow)
const mockIdentFirst = vi.mocked(prisma.userIdentifier.findFirst)
const mockIdentMany = vi.mocked(prisma.userIdentifier.findMany)

function getRequest(): Request {
  return new Request('http://localhost/api/v1/account/me', { method: 'GET' })
}

describe('GET /api/v1/account/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 on AuthError', async () => {
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'unauthorised'))
    const res = await GET(getRequest())
    expect(res.status).toBe(401)
  })

  it('returns a payload that matches AccountMeResponse', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockUser.mockResolvedValueOnce({
      id: 'u1',
      fullName: 'Test User',
      twoFactorMethod: null,
      twoFactorEnabledAt: null,
      twoFactorBackupCodes: [],
    } as never)
    mockIdentFirst.mockResolvedValueOnce(null)
    mockIdentMany.mockResolvedValueOnce([
      { id: 'e1', identifier: 'a@b.com', verified: true },
    ] as never)

    const res = await GET(getRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    // The shape is the OpenAPI response contract; parsing succeeds
    // only if every required key is present.
    expect(() => AccountMeResponse.parse(json)).not.toThrow()
  })

  it('returns 500 on unexpected errors', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockUser.mockRejectedValueOnce(new Error('db blew up'))
    const res = await GET(getRequest())
    expect(res.status).toBe(500)
  })
})
