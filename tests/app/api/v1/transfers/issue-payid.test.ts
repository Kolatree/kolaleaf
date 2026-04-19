import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireEmailVerified: vi.fn(),
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
    transfer: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/payments/monoova', () => ({
  generatePayIdForTransfer: vi.fn(),
}))

vi.mock('@/lib/payments/monoova/client', () => ({
  createMonoovaClient: vi.fn(() => ({})),
}))

import { POST } from '@/app/api/v1/transfers/[id]/issue-payid/route'
import { requireAuth, requireEmailVerified, AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'
import { generatePayIdForTransfer } from '@/lib/payments/monoova'

const mockRequireAuth = vi.mocked(requireAuth)
const mockRequireEmail = vi.mocked(requireEmailVerified)
const mockFindUnique = vi.mocked(prisma.transfer.findUnique)
const mockGenerate = vi.mocked(generatePayIdForTransfer)

function req(): Request {
  return new Request('http://localhost/api/v1/transfers/t1/issue-payid', {
    method: 'POST',
  })
}

describe('POST /api/v1/transfers/[id]/issue-payid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated (email check throws)', async () => {
    mockRequireEmail.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(401)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('returns 403 when email is unverified', async () => {
    mockRequireEmail.mockRejectedValueOnce(new AuthError(403, 'email_unverified'))
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('email_unverified')
  })

  it('returns 404 when the transfer does not exist', async () => {
    mockRequireEmail.mockResolvedValueOnce({ userId: 'u1' })
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('returns 403 when authed user is not the transfer owner', async () => {
    mockRequireEmail.mockResolvedValueOnce({ userId: 'u1' })
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUnique.mockResolvedValueOnce({ userId: 'other' } as never)
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('returns 200 with the updated transfer on success', async () => {
    mockRequireEmail.mockResolvedValueOnce({ userId: 'u1' })
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUnique.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockGenerate.mockResolvedValueOnce({
      id: 't1',
      status: 'AWAITING_AUD',
      payidReference: 'STUB-ref',
    } as never)

    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transfer.status).toBe('AWAITING_AUD')
  })

  it('returns 409 when transfer is not in CREATED state', async () => {
    mockRequireEmail.mockResolvedValueOnce({ userId: 'u1' })
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUnique.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockGenerate.mockRejectedValueOnce(
      new Error('Transfer t1 is not in CREATED state'),
    )
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(409)
  })

  it('returns 403 on KycNotVerifiedError', async () => {
    mockRequireEmail.mockResolvedValueOnce({ userId: 'u1' })
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUnique.mockResolvedValueOnce({ userId: 'u1' } as never)
    const err = new Error('KYC is not verified for user u1')
    err.name = 'KycNotVerifiedError'
    mockGenerate.mockRejectedValueOnce(err)
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 409 on ConcurrentModificationError', async () => {
    mockRequireEmail.mockResolvedValueOnce({ userId: 'u1' })
    mockRequireAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFindUnique.mockResolvedValueOnce({ userId: 'u1' } as never)
    const err = new Error('Transfer t1 was modified concurrently')
    err.name = 'ConcurrentModificationError'
    mockGenerate.mockRejectedValueOnce(err)
    const res = await POST(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(409)
  })
})
