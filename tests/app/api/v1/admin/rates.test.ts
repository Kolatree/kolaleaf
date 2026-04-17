import { describe, it, expect, vi, beforeEach } from 'vitest'

// Route-level tests for POST /api/v1/admin/rates focused on the Zod
// validation surface + auth gating. Business-logic rate-engine
// coverage lives in tests/lib/rates/.
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
    corridor: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/rates', () => {
  // Must be real constructors; vi.mock's factory runs before the test
  // body so arrow-function `vi.fn().mockImplementation(() => ...)` is
  // not treated as a class by the route's `new RateService(...)` call.
  class RateService {
    getCurrentRate = vi.fn(async () => null)
    isRateStale = vi.fn(async () => ({ stale: false, hoursStale: 0 }))
    getRateHistory = vi.fn(async () => [])
    setAdminRate = vi.fn(async () => ({
      id: 'r1',
      corridorId: 'c1',
      customerRate: '1.5',
      wholesaleRate: '1.6',
      source: 'admin',
      fetchedAt: new Date().toISOString(),
    }))
  }
  class DefaultFxRateProvider {}
  return { RateService, DefaultFxRateProvider }
})

vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(),
}))

import { POST } from '@/app/api/v1/admin/rates/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'

const mockRequireAdmin = vi.mocked(requireAdmin)

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/admin/rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/admin/rates (schema validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ userId: 'admin-1' } as never)
  })

  it('returns 401 on AuthError before touching the body', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new AuthError(401, 'unauthorised'))
    const res = await POST(postRequest({}))
    expect(res.status).toBe(401)
  })

  it('returns 400 malformed_json on invalid JSON', async () => {
    const req = new Request('http://localhost/api/v1/admin/rates', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('malformed_json')
  })

  it('returns 422 when corridorId is missing (Zod)', async () => {
    const res = await POST(postRequest({ customerRate: '1.5', wholesaleRate: '1.6' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.reason).toBe('validation_failed')
    expect(json.fields?.corridorId).toBeInstanceOf(Array)
  })

  it('returns 422 when rate values are non-numeric', async () => {
    const res = await POST(
      postRequest({ corridorId: 'c1', customerRate: 'abc', wholesaleRate: 'xyz' }),
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.customerRate).toBeInstanceOf(Array)
    expect(json.fields?.wholesaleRate).toBeInstanceOf(Array)
  })

  it('accepts a valid payload and returns 201 with a rate', async () => {
    const res = await POST(
      postRequest({ corridorId: 'c1', customerRate: '1.5', wholesaleRate: '1.6' }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.rate).toBeTruthy()
  })
})
