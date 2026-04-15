import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db client
vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: {
      findFirst: vi.fn(),
    },
    emailVerificationToken: {
      updateMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>(
    '@/lib/auth/middleware',
  )
  return {
    ...actual,
    requireAuth: vi.fn(),
  }
})

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: 'evt_1' }),
  renderVerificationEmail: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}))

import { POST } from '@/app/api/auth/resend-verification/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'
import { sendEmail } from '@/lib/email'

const mockRequireAuth = vi.mocked(requireAuth)
const mockSend = vi.mocked(sendEmail)

function makeRequest(): Request {
  return new Request('http://localhost/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'kolaleaf_session=x' },
  })
}

describe('POST /api/auth/resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))

    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 with alreadyVerified=true when email already verified', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'a@b.com',
      verified: true,
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.alreadyVerified).toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limit exceeded (>5 in last hour)', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'a@b.com',
      verified: false,
    })
    ;(prisma.emailVerificationToken.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(5)

    const res = await POST(makeRequest())
    expect(res.status).toBe(429)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('invalidates prior tokens, creates new token, sends email, returns 200', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i1',
      userId: 'u1',
      type: 'EMAIL',
      identifier: 'a@b.com',
      verified: false,
    })
    ;(prisma.emailVerificationToken.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1)
    ;(prisma.emailVerificationToken.updateMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 0 })
    ;(prisma.emailVerificationToken.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      tokenHash: 'hash',
      expiresAt: new Date(),
    })
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      fullName: 'Test User',
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalled()
    expect(prisma.emailVerificationToken.create).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when user has no EMAIL identifier', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await POST(makeRequest())
    expect(res.status).toBe(404)
  })
})
