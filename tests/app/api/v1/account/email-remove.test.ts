import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    public readonly statusCode: number
    constructor(statusCode: number, message: string) {
      super(message)
      this.statusCode = statusCode
    }
  },
}))

import { DELETE } from '@/app/api/v1/account/email/[id]/route'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

const USER_ID = 'user_1'

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/account/email/id_1', {
    method: 'DELETE',
  })
}

function mockSession() {
  ;(requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER_ID,
    session: { id: 's1', userId: USER_ID, token: 't', expiresAt: new Date() },
  })
}

function call(id = 'id_1') {
  return DELETE(makeRequest(), { params: Promise.resolve({ id }) })
}

describe('DELETE /api/v1/account/email/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    ;(requireAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AuthError(401, 'Authentication required'),
    )
    const res = await call()
    expect(res.status).toBe(401)
  })

  it('returns 404 when identifier not found', async () => {
    mockSession()
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('returns 404 when identifier belongs to another user', async () => {
    mockSession()
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'id_1',
      userId: 'other_user',
      type: 'EMAIL',
      identifier: 'x@y.com',
      verified: true,
    })
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('returns 404 when identifier is not type EMAIL', async () => {
    mockSession()
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'id_1',
      userId: USER_ID,
      type: 'PHONE',
      identifier: '+61...',
      verified: true,
    })
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('returns 400 when attempting to remove the only verified email', async () => {
    mockSession()
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'id_1',
      userId: USER_ID,
      type: 'EMAIL',
      identifier: 'only@b.com',
      verified: true,
    })
    ;(prisma.userIdentifier.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    const res = await call()
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('cannot_remove_only_email')
    expect(prisma.userIdentifier.delete).not.toHaveBeenCalled()
  })

  it('removes unverified identifier freely and logs EMAIL_REMOVED', async () => {
    mockSession()
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'id_1',
      userId: USER_ID,
      type: 'EMAIL',
      identifier: 'old@b.com',
      verified: false,
    })
    const res = await call()
    expect(res.status).toBe(200)
    expect(prisma.userIdentifier.delete).toHaveBeenCalledWith({ where: { id: 'id_1' } })
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'EMAIL_REMOVED',
          metadata: expect.objectContaining({ wasVerified: false }),
        }),
      }),
    )
    // No need to count other verified emails for an unverified delete.
    expect(prisma.userIdentifier.count).not.toHaveBeenCalled()
  })

  it('removes verified identifier when other verified emails exist', async () => {
    mockSession()
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'id_1',
      userId: USER_ID,
      type: 'EMAIL',
      identifier: 'secondary@b.com',
      verified: true,
    })
    ;(prisma.userIdentifier.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    const res = await call()
    expect(res.status).toBe(200)
    expect(prisma.userIdentifier.delete).toHaveBeenCalledWith({ where: { id: 'id_1' } })
  })
})
