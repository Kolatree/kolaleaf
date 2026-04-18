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

vi.mock('@/lib/transfers/state-machine', () => ({
  transitionTransfer: vi.fn(),
}))

vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

import { POST as REFUND } from '@/app/api/v1/admin/transfers/[id]/refund/route'
import { POST as RETRY } from '@/app/api/v1/admin/transfers/[id]/retry/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { transitionTransfer } from '@/lib/transfers/state-machine'

const mockRequireAdmin = vi.mocked(requireAdmin)
const mockTransition = vi.mocked(transitionTransfer)

function req(url: string): Request {
  return new Request(url, { method: 'POST' })
}

describe('admin/transfers/[id]/{refund,retry}', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refund returns 401 on AuthError', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await REFUND(
      req('http://localhost/api/v1/admin/transfers/t1/refund'),
      { params: Promise.resolve({ id: 't1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('refund returns 200 when transition succeeds', async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    mockTransition.mockResolvedValueOnce({ id: 't1', status: 'REFUNDED' } as never)
    const res = await REFUND(
      req('http://localhost/api/v1/admin/transfers/t1/refund'),
      { params: Promise.resolve({ id: 't1' }) },
    )
    expect(res.status).toBe(200)
  })

  it('retry returns 409 on InvalidTransitionError', async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    const err = new Error('invalid')
    err.name = 'InvalidTransitionError'
    mockTransition.mockRejectedValueOnce(err)
    const res = await RETRY(
      req('http://localhost/api/v1/admin/transfers/t1/retry'),
      { params: Promise.resolve({ id: 't1' }) },
    )
    expect(res.status).toBe(409)
  })
})
