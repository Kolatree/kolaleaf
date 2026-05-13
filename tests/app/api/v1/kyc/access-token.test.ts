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
  getKycAccessToken: vi.fn(),
}))

import { POST } from '@/app/api/v1/kyc/access-token/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { getKycAccessToken } from '@/lib/kyc/sumsub/kyc-service'

const mockAuth = vi.mocked(requireAuth)
const mockAccessToken = vi.mocked(getKycAccessToken)

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/kyc/access-token', { method: 'POST' })
}

describe('POST /api/v1/kyc/access-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 with canonical {error, reason} envelope when not authenticated', async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Unauthenticated',
      reason: 'unauthenticated',
    })
  })

  it('returns a fresh WebSDK access token on success', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockAccessToken.mockResolvedValueOnce({
      applicantId: 'a1',
      accessToken: 'token-1',
      verificationUrl: 'https://sumsub.test/v',
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      applicantId: 'a1',
      accessToken: 'token-1',
      verificationUrl: 'https://sumsub.test/v',
    })
  })

  it('returns 409 with reason=kyc_no_application when no application is in progress', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockAccessToken.mockRejectedValueOnce(new Error('No KYC application in progress'))

    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: 'No KYC application in progress',
      reason: 'kyc_no_application',
    })
  })

  it('returns 409 with reason=kyc_already_verified when KYC is complete', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockAccessToken.mockRejectedValueOnce(new Error('KYC already verified'))

    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: 'KYC already verified',
      reason: 'kyc_already_verified',
    })
  })

  it('returns 500 with reason=kyc_access_token_failed on unexpected error', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockAccessToken.mockRejectedValueOnce(new Error('Sumsub timeout'))

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Sumsub timeout',
      reason: 'kyc_access_token_failed',
    })
  })
})
