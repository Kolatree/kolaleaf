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

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>(
    '@/lib/auth/middleware',
  )
  return {
    ...actual,
    requireAuth: vi.fn(),
  }
})

vi.mock('@/lib/auth/totp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/totp')>('@/lib/auth/totp')
  return {
    ...actual,
    verifyTotpCode: vi.fn(),
    verifyBackupCode: vi.fn(),
  }
})

vi.mock('@/lib/auth/two-factor-challenge', () => ({
  verifyChallenge: vi.fn(),
}))

import { POST } from '@/app/api/account/2fa/disable/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'
import { verifyTotpCode, verifyBackupCode } from '@/lib/auth/totp'
import { verifyChallenge } from '@/lib/auth/two-factor-challenge'

const mockRequireAuth = vi.mocked(requireAuth)
const mockVerifyTotp = vi.mocked(verifyTotpCode)
const mockVerifyBackup = vi.mocked(verifyBackupCode)
const mockVerifyChallenge = vi.mocked(verifyChallenge)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/account/2fa/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'kolaleaf_session=x' },
    body: JSON.stringify(body),
  })
}

function mockAuthed(userId = 'u1', sessionId = 's1'): void {
  mockRequireAuth.mockResolvedValueOnce({
    userId,
    session: { id: sessionId, userId } as never,
  })
}

describe('POST /api/account/2fa/disable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))
    const res = await POST(makeRequest({ code: '123456' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 not_enabled when 2FA is off', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
      twoFactorSecret: null,
      twoFactorBackupCodes: [],
    })
    const res = await POST(makeRequest({ code: '123456' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('not_enabled')
  })

  it('returns 400 for missing code', async () => {
    mockAuthed()
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('TOTP user with valid current code disables 2FA', async () => {
    mockAuthed('u1', 's1')
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'TOTP',
      twoFactorSecret: 'SECRET',
      twoFactorBackupCodes: ['h1', 'h2'],
    })
    mockVerifyTotp.mockReturnValueOnce(true)
    ;(prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.session.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ code: '123456' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.disabled).toBe(true)

    // User updated to NONE / cleared
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          twoFactorMethod: 'NONE',
          twoFactorSecret: null,
          twoFactorBackupCodes: [],
          twoFactorEnabledAt: null,
        }),
      }),
    )

    // Other sessions force-logged-out, current kept
    expect(prisma.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          id: { not: 's1' },
        }),
      }),
    )

    // AuthEvent
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          event: 'TWO_FACTOR_DISABLED',
        }),
      }),
    )
  })

  it('falls back to backup code when TOTP code invalid', async () => {
    mockAuthed('u1', 's1')
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'TOTP',
      twoFactorSecret: 'SECRET',
      twoFactorBackupCodes: ['h1', 'h2'],
    })
    mockVerifyTotp.mockReturnValueOnce(false)
    mockVerifyBackup.mockResolvedValueOnce({ valid: true, remainingHashes: ['h2'] })
    ;(prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.session.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ code: 'AAAA-111111' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.disabled).toBe(true)
  })

  it('SMS user with valid challenge + code disables 2FA', async () => {
    mockAuthed('u1', 's1')
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'SMS',
      twoFactorSecret: null,
      twoFactorBackupCodes: ['h1'],
    })
    mockVerifyChallenge.mockResolvedValueOnce(true)
    ;(prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.session.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ code: '123456', challengeId: 'c1' }))
    expect(res.status).toBe(200)
  })

  it('returns 400 invalid_code when nothing verifies', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'TOTP',
      twoFactorSecret: 'SECRET',
      twoFactorBackupCodes: ['h1'],
    })
    mockVerifyTotp.mockReturnValueOnce(false)
    mockVerifyBackup.mockResolvedValueOnce({ valid: false, remainingHashes: ['h1'] })

    const res = await POST(makeRequest({ code: '999999' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_code')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})
