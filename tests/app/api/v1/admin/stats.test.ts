import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/admin-middleware', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/middleware', () => ({
  AuthError: class extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg)
      this.name = 'AuthError'
      this.statusCode = statusCode
    }
  },
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    transfer: {
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _sum: { sendAmount: null } })),
      groupBy: vi.fn(async () => []),
    },
    user: {
      count: vi.fn(async () => 0),
    },
  },
}))

import { GET } from '@/app/api/v1/admin/stats/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'

const mockRequireAdmin = vi.mocked(requireAdmin)

function req(): Request {
  return new Request('http://localhost/api/v1/admin/stats')
}

describe('GET /api/v1/admin/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 on AuthError', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns dashboard stats on success', async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stats).toBeTruthy()
    expect(typeof json.stats.transfersToday).toBe('number')
  })
})
