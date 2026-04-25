import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const { _requireAdmin } = vi.hoisted(() => ({
  _requireAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/admin-middleware', () => {
  const { NextResponse } = require('next/server')
  return {
    requireAdmin: _requireAdmin,
    getAdminEmails: () => ['admin@kolaleaf.com'],
    withAdmin: (handler: Function) => async (request: Request) => {
      try {
        const { userId } = await _requireAdmin(request)
        return await handler(request, userId)
      } catch (error: any) {
        if (error?.name === 'AuthError') {
          return NextResponse.json({ error: error.message, reason: error.message }, { status: error.statusCode })
        }
        const msg = error instanceof Error ? error.message : 'Request failed'
        if (error?.name === 'InvalidTransitionError' || error?.name === 'ConcurrentModificationError') {
          return NextResponse.json({ error: msg, reason: 'conflict' }, { status: 409 })
        }
        if (error?.name === 'TransferNotFoundError') {
          return NextResponse.json({ error: msg, reason: 'transfer_not_found' }, { status: 404 })
        }
        return NextResponse.json({ error: 'Internal server error', reason: 'internal_error' }, { status: 500 })
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
    transfer: {
      findMany: vi.fn(async () => []),
      findUniqueOrThrow: vi.fn(),
    },
  },
}))

import { GET as GET_LIST } from '@/app/api/v1/admin/transfers/route'
import { GET as GET_DETAIL } from '@/app/api/v1/admin/transfers/[id]/route'
import { AuthError } from '@/lib/auth/middleware'

const mockRequireAdmin = _requireAdmin

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
