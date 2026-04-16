import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
    },
    userIdentifier: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/password', () => ({
  verifyPassword: vi.fn(),
}))

vi.mock('@/lib/auth/email-verification', () => ({
  issueVerificationCode: vi.fn(async () => ({ ok: true })),
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

import { POST } from '@/app/api/account/change-email/route'
import { prisma } from '@/lib/db/client'
import { verifyPassword } from '@/lib/auth/password'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { issueVerificationCode } from '@/lib/auth/email-verification'

const mockIssue = vi.mocked(issueVerificationCode)

const USER_ID = 'user_1'
const OTHER_USER_ID = 'user_other'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/account/change-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockSession() {
  ;(requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER_ID,
    session: { id: 's1', userId: USER_ID, token: 't', expiresAt: new Date() },
  })
}

describe('POST /api/account/change-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    ;(requireAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AuthError(401, 'Authentication required'),
    )
    const res = await POST(makeRequest({ currentPassword: 'x', newEmail: 'a@b.com' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when new email invalid', async () => {
    mockSession()
    const res = await POST(makeRequest({ currentPassword: 'x', newEmail: 'notanemail' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 on wrong current password + logs EMAIL_CHANGE_FAILED', async () => {
    mockSession()
    ;(prisma.user.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: USER_ID,
      fullName: 'Alice',
      passwordHash: 'h',
    })
    ;(verifyPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false)

    const res = await POST(makeRequest({ currentPassword: 'wrong', newEmail: 'new@b.com' }))
    expect(res.status).toBe(401)
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'EMAIL_CHANGE_FAILED' }),
      }),
    )
  })

  it('returns 409 when new email already verified by another user', async () => {
    mockSession()
    ;(prisma.user.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: USER_ID,
      fullName: 'Alice',
      passwordHash: 'h',
    })
    ;(verifyPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'id_x',
      userId: OTHER_USER_ID,
      type: 'EMAIL',
      identifier: 'new@b.com',
      verified: true,
    })

    const res = await POST(makeRequest({ currentPassword: 'ok', newEmail: 'new@b.com' }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('email_taken')
  })

  it('happy path: creates unverified identifier, dispatches verification code, logs EMAIL_CHANGE_INITIATED', async () => {
    mockSession()
    ;(prisma.user.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: USER_ID,
      fullName: 'Alice',
      passwordHash: 'h',
    })
    ;(verifyPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prisma.userIdentifier.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'new_id',
      userId: USER_ID,
      type: 'EMAIL',
      identifier: 'new@b.com',
      verified: false,
    })
    mockIssue.mockResolvedValueOnce({ ok: true })

    const res = await POST(makeRequest({ currentPassword: 'ok', newEmail: 'new@b.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(true)
    expect(json.newEmail).toBe('new@b.com')

    expect(prisma.userIdentifier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          type: 'EMAIL',
          identifier: 'new@b.com',
          verified: false,
        }),
      }),
    )
    expect(mockIssue).toHaveBeenCalledWith({
      userId: USER_ID,
      email: 'new@b.com',
      recipientName: 'Alice',
    })
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'EMAIL_CHANGE_INITIATED' }),
      }),
    )
  })

  it('transfers ownership when existing row is unverified and owned by another user', async () => {
    mockSession()
    ;(prisma.user.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: USER_ID,
      fullName: 'Alice',
      passwordHash: 'h',
    })
    ;(verifyPassword as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(prisma.userIdentifier.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abandoned_id',
      userId: OTHER_USER_ID,
      type: 'EMAIL',
      identifier: 'new@b.com',
      verified: false,
    })
    ;(prisma.userIdentifier.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abandoned_id',
      userId: USER_ID,
      type: 'EMAIL',
      identifier: 'new@b.com',
      verified: false,
    })
    mockIssue.mockResolvedValueOnce({ ok: true })

    const res = await POST(makeRequest({ currentPassword: 'ok', newEmail: 'new@b.com' }))
    expect(res.status).toBe(200)
    expect(prisma.userIdentifier.update).toHaveBeenCalledWith({
      where: { id: 'abandoned_id' },
      data: { userId: USER_ID, verified: false, verifiedAt: null },
    })
  })
})
