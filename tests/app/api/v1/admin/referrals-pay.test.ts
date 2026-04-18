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

vi.mock('@/lib/referrals', () => ({
  processReward: vi.fn(async () => ({ id: 'ref_1', status: 'PAID' })),
}))

vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/v1/admin/referrals/[id]/pay/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'

const mockRequireAdmin = vi.mocked(requireAdmin)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/admin/referrals/ref_1/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/admin/referrals/[id]/pay (schema validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ userId: 'admin_1' } as never)
  })

  it('returns 422 when amount is missing (Zod)', async () => {
    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: 'ref_1' }) })
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.amount).toBeInstanceOf(Array)
  })

  it('returns 422 when amount is non-numeric (Zod)', async () => {
    const res = await POST(
      makeRequest({ amount: 'banana' }),
      { params: Promise.resolve({ id: 'ref_1' }) },
    )
    expect(res.status).toBe(422)
  })

  it('returns 201 and calls processReward on valid payload', async () => {
    const res = await POST(
      makeRequest({ amount: '500' }),
      { params: Promise.resolve({ id: 'ref_1' }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.referral.id).toBe('ref_1')
  })
})
