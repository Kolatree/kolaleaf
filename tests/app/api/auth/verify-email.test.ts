import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    emailVerificationToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userIdentifier: {
      updateMany: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
    },
  },
}))

import { GET } from '@/app/api/auth/verify-email/route'
import { prisma } from '@/lib/db/client'

function makeRequest(token?: string): Request {
  const url = token
    ? `http://localhost/api/auth/verify-email?token=${token}`
    : 'http://localhost/api/auth/verify-email'
  return new Request(url, { method: 'GET' })
}

describe('GET /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns HTML error page when token missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const text = await res.text()
    expect(text).toMatch(/expired|invalid|missing/i)
  })

  it('returns HTML error when token not found', async () => {
    ;(prisma.emailVerificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await GET(makeRequest('a'.repeat(64)))
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toMatch(/expired|invalid/i)
  })

  it('returns HTML error when token expired', async () => {
    ;(prisma.emailVerificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      email: 'a@b.com',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    })
    const res = await GET(makeRequest('a'.repeat(64)))
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toMatch(/expired|invalid/i)
  })

  it('returns HTML error when token already used', async () => {
    ;(prisma.emailVerificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      email: 'a@b.com',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    })
    const res = await GET(makeRequest('a'.repeat(64)))
    expect(res.status).toBe(400)
  })

  it('marks token used, identifier verified, and logs AuthEvent on success', async () => {
    ;(prisma.emailVerificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      email: 'a@b.com',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    })
    ;(prisma.userIdentifier.updateMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 1 })
    ;(prisma.emailVerificationToken.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})

    const res = await GET(makeRequest('a'.repeat(64)))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toMatch(/verified/i)

    expect(prisma.emailVerificationToken.update).toHaveBeenCalled()
    expect(prisma.userIdentifier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', type: 'EMAIL', identifier: 'a@b.com' }),
      }),
    )
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          event: 'EMAIL_VERIFIED',
        }),
      }),
    )
  })

  it('renders expired page when identifier row is gone (updateMany count === 0)', async () => {
    ;(prisma.emailVerificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 't1',
      userId: 'u1',
      email: 'a@b.com',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    })
    // Identifier was deleted/re-created after token issue — zero rows updated.
    ;(prisma.userIdentifier.updateMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 0 })

    const res = await GET(makeRequest('a'.repeat(64)))
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toMatch(/expired|invalid/i)

    // Token must NOT be consumed — user can try again after re-adding the address.
    expect(prisma.emailVerificationToken.update).not.toHaveBeenCalled()
    // No AuthEvent on a failed verification.
    expect(prisma.authEvent.create).not.toHaveBeenCalled()
  })
})
