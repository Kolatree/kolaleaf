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

vi.mock('@/lib/kyc/sumsub', () => ({
  createSumsubClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/kyc/sumsub/kyc-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kyc/sumsub/kyc-service')>(
    '@/lib/kyc/sumsub/kyc-service',
  )
  return { ...actual, initiateKyc: vi.fn() }
})

import { POST } from '@/app/api/v1/kyc/initiate/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { initiateKyc, KycRateLimitError } from '@/lib/kyc/sumsub/kyc-service'

const mockAuth = vi.mocked(requireAuth)
const mockInit = vi.mocked(initiateKyc)

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/kyc/initiate', { method: 'POST' })
}

describe('POST /api/v1/kyc/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns applicantId + verificationUrl on success', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockInit.mockResolvedValueOnce({
      applicantId: 'a1',
      verificationUrl: 'https://sumsub.test/v',
    } as never)
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.applicantId).toBe('a1')
  })

  it('returns 409 when KYC is already verified', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockInit.mockRejectedValueOnce(new Error('KYC already verified'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
  })

  it('returns 429 + Retry-After when rate-limited', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockInit.mockRejectedValueOnce(new KycRateLimitError(90_000))
    const res = await POST(makeRequest())
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('90')
    const json = (await res.json()) as { error: string; retryAfterMs: number }
    expect(json.error).toBe('kyc_initiate_rate_limited')
    expect(json.retryAfterMs).toBe(90_000)
  })
})
