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
  getTransfer: vi.fn(),
}))

import { GET } from '@/app/api/v1/transfers/[id]/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { getTransfer } from '@/lib/transfers'

const mockAuth = vi.mocked(requireAuth)
const mockGet = vi.mocked(getTransfer)

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/transfers/t1', { method: 'GET' })
}

describe('GET /api/v1/transfers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 on AuthError', async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when the transfer is not found', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockGet.mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 200 with the transfer on success', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockGet.mockResolvedValueOnce({ id: 't1', status: 'CREATED' } as never)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
  })
})
