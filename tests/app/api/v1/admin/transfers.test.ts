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
      findMany: vi.fn(async () => []),
      findUniqueOrThrow: vi.fn(),
    },
  },
}))

import { GET as GET_LIST } from '@/app/api/v1/admin/transfers/route'
import { GET as GET_DETAIL } from '@/app/api/v1/admin/transfers/[id]/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'

const mockRequireAdmin = vi.mocked(requireAdmin)

describe('admin/transfers routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET list returns 401 on AuthError', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await GET_LIST(new Request('http://localhost/api/v1/admin/transfers'))
    expect(res.status).toBe(401)
  })

  it('GET list returns paginated transfers on success', async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    const res = await GET_LIST(new Request('http://localhost/api/v1/admin/transfers'))
    expect(res.status).toBe(200)
  })

  it('GET detail returns 401 on AuthError', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await GET_DETAIL(
      new Request('http://localhost/api/v1/admin/transfers/t1'),
      { params: Promise.resolve({ id: 't1' }) },
    )
    expect(res.status).toBe(401)
  })
})
