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

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}))

vi.mock('@/lib/kyc/sumsub/kyc-service', () => ({
  handleKycApproved: vi.fn(),
  handleKycRejected: vi.fn(),
}))

import { POST } from '@/app/api/v1/kyc/mock/complete/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { handleKycApproved, handleKycRejected } from '@/lib/kyc/sumsub/kyc-service'

const mockAuth = vi.mocked(requireAuth)
const mockFindUser = vi.mocked(prisma.user.findUniqueOrThrow)
const mockApprove = vi.mocked(handleKycApproved)
const mockReject = vi.mocked(handleKycRejected)

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/v1/kyc/mock/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/kyc/mock/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'development')
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await POST(makeRequest({ outcome: 'approve' }))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Unauthenticated',
      reason: 'unauthenticated',
    })
  })

  it('returns 404 in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await POST(makeRequest({ outcome: 'approve' }))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Not found',
      reason: 'not_found',
    })
  })

  it('approves mock verification when a KYC application exists', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUser.mockResolvedValueOnce({
      kycStatus: 'IN_REVIEW',
      kycProviderId: 'mock-sumsub-u1',
    } as never)

    const res = await POST(makeRequest({ outcome: 'approve' }))
    expect(res.status).toBe(200)
    expect(mockApprove).toHaveBeenCalledWith('u1')
  })

  it('rejects mock verification when requested', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUser.mockResolvedValueOnce({
      kycStatus: 'IN_REVIEW',
      kycProviderId: 'mock-sumsub-u1',
    } as never)

    const res = await POST(makeRequest({ outcome: 'reject' }))
    expect(res.status).toBe(200)
    expect(mockReject).toHaveBeenCalledWith('u1', ['MOCK_REJECTED'])
  })

  it('returns 409 when there is no KYC application', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUser.mockResolvedValueOnce({
      kycStatus: 'PENDING',
      kycProviderId: null,
    } as never)

    const res = await POST(makeRequest({ outcome: 'approve' }))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: 'No KYC application in progress',
      reason: 'kyc_no_application',
    })
  })
})
