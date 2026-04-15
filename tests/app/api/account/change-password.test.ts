import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return {
    ...actual,
    hashPassword: vi.fn(async () => 'new_hash'),
    verifyPassword: vi.fn(),
  }
})

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

import { POST } from '@/app/api/account/change-password/route'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from '@/lib/auth/password'
import { requireAuth } from '@/lib/auth/middleware'

const STRONG = 'NewStrongPass123!'
const CURRENT_SESSION_ID = 'sess_current'
const USER_ID = 'user_1'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/account/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockSession() {
  ;(requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER_ID,
    session: { id: CURRENT_SESSION_ID, userId: USER_ID, token: 't', expiresAt: new Date() },
  })
}

describe('POST /api/account/change-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    ;(requireAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('Authentication required'), { statusCode: 401 }),
    )
    const { AuthError } = await import('@/lib/auth/middleware')
    ;(requireAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AuthError(401, 'Authentication required'),
    )
    const res = await POST(makeRequest({ currentPassword: 'x', newPassword: STRONG }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when current password missing', async () => {
    mockSession()
    const res = await POST(makeRequest({ newPassword: STRONG }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when new password too weak', async () => {
    mockSession()
    const res = await POST(makeRequest({ currentPassword: 'x', newPassword: 'short' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when current password is wrong + logs PASSWORD_CHANGE_FAILED', async () => {
    mockSession()
    ;(prisma.user.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: USER_ID,
      passwordHash: 'stored_hash',
    })
    ;(verifyPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false)

    const res = await POST(makeRequest({ currentPassword: 'wrong', newPassword: STRONG }))
    expect(res.status).toBe(401)
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'PASSWORD_CHANGE_FAILED',
        }),
      }),
    )
  })

  it('happy path: rotates hash, force-logs-out OTHER sessions, keeps current, logs PASSWORD_CHANGED', async () => {
    mockSession()
    ;(prisma.user.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: USER_ID,
      passwordHash: 'stored_hash',
    })
    ;(verifyPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true)

    const res = await POST(makeRequest({ currentPassword: 'correct', newPassword: STRONG }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.changed).toBe(true)

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({ passwordHash: 'new_hash' }),
      }),
    )
    // Current session must survive force-logout.
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { not: CURRENT_SESSION_ID } },
    })
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'PASSWORD_CHANGED' }),
      }),
    )
  })

  it('returns 401 when user has no passwordHash (SSO-only)', async () => {
    mockSession()
    ;(prisma.user.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: USER_ID,
      passwordHash: null,
    })

    const res = await POST(makeRequest({ currentPassword: 'x', newPassword: STRONG }))
    expect(res.status).toBe(401)
  })
})
