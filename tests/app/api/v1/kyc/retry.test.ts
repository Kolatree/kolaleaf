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

vi.mock('@/lib/kyc/sumsub/kyc-service', () => ({
  retryKyc: vi.fn(),
}))

import { POST } from '@/app/api/v1/kyc/retry/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { retryKyc } from '@/lib/kyc/sumsub/kyc-service'

const mockAuth = vi.mocked(requireAuth)
const mockRetry = vi.mocked(retryKyc)

const makeRequest = () =>
  new Request('http://localhost/api/v1/kyc/retry', { method: 'POST' })

describe('POST /api/v1/kyc/retry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns accessToken + verificationUrl on success', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockRetry.mockResolvedValueOnce({
      accessToken: 'tok',
      verificationUrl: 'https://sumsub.test/v',
    } as never)
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { accessToken: string; verificationUrl: string }
    expect(json.accessToken).toBe('tok')
    expect(json.verificationUrl).toBe('https://sumsub.test/v')
  })

  it('returns 409 when kycStatus is not REJECTED', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockRetry.mockRejectedValueOnce(
      new Error('KYC retry only available for rejected applications'),
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
  })

  it('returns 409 when no prior Sumsub applicantId exists', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockRetry.mockRejectedValueOnce(new Error('No existing KYC application to retry'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
  })
})
