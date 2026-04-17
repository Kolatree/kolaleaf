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
    verifyBackupCode: vi.fn(),
    generateBackupCodes: vi.fn(() => ({
      codes: ['NEW1-111111', 'NEW2-222222', 'NEW3-333333', 'NEW4-444444', 'NEW5-555555', 'NEW6-666666', 'NEW7-777777', 'NEW8-888888'],
      hashes: ['nh1', 'nh2', 'nh3', 'nh4', 'nh5', 'nh6', 'nh7', 'nh8'],
    })),
  }
})

vi.mock('@/lib/auth/two-factor-challenge', () => ({
  verifyChallenge: vi.fn(),
}))

import { POST } from '@/app/api/v1/account/2fa/regenerate-backup-codes/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'
import { verifyTotpCode, verifyBackupCode } from '@/lib/auth/totp'

const mockRequireAuth = vi.mocked(requireAuth)
const mockVerifyTotp = vi.mocked(verifyTotpCode)
const mockVerifyBackup = vi.mocked(verifyBackupCode)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/account/2fa/regenerate-backup-codes', {
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

describe('POST /api/v1/account/2fa/regenerate-backup-codes', () => {
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

  it('valid TOTP code generates fresh backup codes and invalidates old', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'TOTP',
      twoFactorSecret: 'SECRET',
      twoFactorBackupCodes: ['h1', 'h2'],
    })
    mockVerifyTotp.mockReturnValueOnce(true)
    ;(prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ code: '123456' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.backupCodes).toHaveLength(8)
    expect(json.backupCodes[0]).toBe('NEW1-111111')

    // User updated with new hashes, replacing old
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          twoFactorBackupCodes: ['nh1', 'nh2', 'nh3', 'nh4', 'nh5', 'nh6', 'nh7', 'nh8'],
        }),
      }),
    )

    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'TWO_FACTOR_BACKUP_CODES_REGENERATED',
        }),
      }),
    )
  })

  it('invalid code returns 400 and does not regenerate', async () => {
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
