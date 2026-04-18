import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('@/lib/transfers', () => ({
  cancelTransfer: vi.fn(),
}))

import { POST } from '@/app/api/v1/transfers/[id]/cancel/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { cancelTransfer } from '@/lib/transfers'

const mockAuth = vi.mocked(requireAuth)
const mockCancel = vi.mocked(cancelTransfer)

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/transfers/t1/cancel', { method: 'POST' })
}

describe('POST /api/v1/transfers/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 on AuthError', async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 200 with the cancelled transfer on success', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockCancel.mockResolvedValueOnce({ id: 't1', status: 'CANCELLED' } as never)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })

  it('returns 404 when the transfer is not found', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    const err = new Error('Not found')
    err.name = 'TransferNotFoundError'
    mockCancel.mockRejectedValueOnce(err)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
  })
})
