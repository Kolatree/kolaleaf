import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
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
    generateBackupCodes: vi.fn(() => ({
      codes: ['AAAA-111111', 'BBBB-222222', 'CCCC-333333', 'DDDD-444444', 'EEEE-555555', 'FFFF-666666', 'GGGG-777777', 'HHHH-888888'],
      hashes: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'],
    })),
  }
})

vi.mock('@/lib/auth/two-factor-challenge', () => ({
  verifyChallenge: vi.fn(),
}))

import { POST } from '@/app/api/account/2fa/enable/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'
import { verifyTotpCode } from '@/lib/auth/totp'
import { verifyChallenge } from '@/lib/auth/two-factor-challenge'

const mockRequireAuth = vi.mocked(requireAuth)
const mockVerifyTotp = vi.mocked(verifyTotpCode)
const mockVerifyChallenge = vi.mocked(verifyChallenge)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/account/2fa/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'kolaleaf_session=x' },
    body: JSON.stringify(body),
  })
}

function mockAuthed(userId = 'u1'): void {
  mockRequireAuth.mockResolvedValueOnce({
    userId,
    session: { id: 's1', userId } as never,
  })
}

describe('POST /api/account/2fa/enable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))
    const res = await POST(makeRequest({ method: 'TOTP', secret: 's', code: '000000' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 already_enabled when user has 2FA on', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'TOTP',
    })
    const res = await POST(makeRequest({ method: 'TOTP', secret: 's', code: '000000' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('already_enabled')
  })

  it('TOTP invalid code returns 400', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    mockVerifyTotp.mockReturnValueOnce(false)

    const res = await POST(makeRequest({ method: 'TOTP', secret: 'SECRET', code: '999999' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_code')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('TOTP valid code commits user update + AuthEvent and returns backup codes', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    mockVerifyTotp.mockReturnValueOnce(true)
    ;(prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ method: 'TOTP', secret: 'SECRET', code: '123456' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.enabled).toBe(true)
    expect(json.backupCodes).toHaveLength(8)
    expect(json.backupCodes[0]).toBe('AAAA-111111')

    // Transaction called
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)

    // User updated with secret and hashes
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          twoFactorMethod: 'TOTP',
          twoFactorSecret: 'SECRET',
          twoFactorBackupCodes: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'],
        }),
      }),
    )

    // AuthEvent written
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          event: 'TWO_FACTOR_ENABLED',
          metadata: expect.objectContaining({ method: 'TOTP' }),
        }),
      }),
    )
  })

  it('SMS invalid challenge returns 400', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    mockVerifyChallenge.mockResolvedValueOnce(false)

    const res = await POST(makeRequest({ method: 'SMS', challengeId: 'c1', code: '000000' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_code')
  })

  it('SMS valid challenge commits and returns backup codes', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    mockVerifyChallenge.mockResolvedValueOnce(true)
    ;(prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ method: 'SMS', challengeId: 'c1', code: '123456' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.enabled).toBe(true)
    expect(json.backupCodes).toHaveLength(8)

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          twoFactorMethod: 'SMS',
          twoFactorSecret: null,
        }),
      }),
    )

    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'TWO_FACTOR_ENABLED',
          metadata: expect.objectContaining({ method: 'SMS' }),
        }),
      }),
    )
  })

  it('returns 400 for invalid body', async () => {
    mockAuthed()
    const res = await POST(makeRequest({ method: 'TOTP' }))
    expect(res.status).toBe(400)
  })
})
