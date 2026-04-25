import { describe, it, expect, vi, beforeEach } from 'vitest'

const { _requireAdmin } = vi.hoisted(() => ({
  _requireAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/admin-middleware', () => {
  const { NextResponse } = require('next/server')
  class AuthError extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg); this.name = 'AuthError'; this.statusCode = statusCode
    }
  }
  return {
    requireAdmin: _requireAdmin,
    getAdminEmails: () => ['admin@kolaleaf.com'],
    withAdmin: (handler: Function) => async (request: Request) => {
      try {
        const { userId } = await _requireAdmin(request)
        return await handler(request, userId)
      } catch (error: any) {
        if (error instanceof AuthError || error?.name === 'AuthError') {
          return NextResponse.json({ error: error.message }, { status: error.statusCode })
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
  }
})

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

vi.mock('@/lib/obs/logger', () => ({
  log: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    complianceReport: {
      findMany: vi.fn(async () => []),
    },
  },
}))

import { GET } from '@/app/api/v1/admin/compliance/route'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

const mockRequireAdmin = _requireAdmin
const mockFindMany = vi.mocked(prisma.complianceReport.findMany)

function req(): Request {
  return new Request('http://localhost/api/v1/admin/compliance')
}

describe('GET /api/v1/admin/compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 on AuthError', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns an empty list when there are no reports', async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reports).toEqual([])
  })

  it('applies reported-status filters to the query', async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    await GET(new Request('http://localhost/api/v1/admin/compliance?status=PENDING'))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reportedAt: null }),
      }),
    )

    mockFindMany.mockClear()
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    await GET(new Request('http://localhost/api/v1/admin/compliance?status=REPORTED'))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reportedAt: { not: null } }),
      }),
    )
  })
})
