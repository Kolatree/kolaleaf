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

vi.mock('@/lib/payments/payout', () => {
  class FloatMonitor {
    constructor(_provider: unknown) {}
    checkFloatBalance = vi.fn(async () => ({
      provider: 'flutterwave',
      balance: { toString: () => '1000000' },
      sufficient: true,
    }))
  }
  return { FloatMonitor }
})

import { GET } from '@/app/api/v1/admin/float/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'

const mockRequireAdmin = vi.mocked(requireAdmin)

describe('GET /api/v1/admin/float', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 on AuthError', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await GET(new Request('http://localhost/api/v1/admin/float'))
    expect(res.status).toBe(401)
  })

  it('returns float status with threshold on success', async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: 'admin' } as never)
    const res = await GET(new Request('http://localhost/api/v1/admin/float'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.float.provider).toBe('flutterwave')
    expect(json.float.sufficient).toBe(true)
  })
})
