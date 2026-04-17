import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
    },
    userIdentifier: {
      findFirst: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
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

vi.mock('@/lib/auth/totp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/totp')>('@/lib/auth/totp')
  return {
    ...actual,
    generateTotpSecret: vi.fn(() => 'FAKESECRET123456'),
    buildOtpauthUri: vi.fn(() => 'otpauth://totp/Kolaleaf:u%40example.com?secret=FAKESECRET123456&issuer=Kolaleaf'),
    generateQrCodeDataUrl: vi.fn(async () => 'data:image/png;base64,FAKEQR'),
  }
})

vi.mock('@/lib/auth/two-factor-challenge', () => ({
  issueSmsChallenge: vi.fn(),
}))

import { POST } from '@/app/api/v1/account/2fa/setup/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'
import { issueSmsChallenge } from '@/lib/auth/two-factor-challenge'

const mockRequireAuth = vi.mocked(requireAuth)
const mockIssueSmsChallenge = vi.mocked(issueSmsChallenge)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/account/2fa/setup', {
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

describe('POST /api/v1/account/2fa/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))
    const res = await POST(makeRequest({ method: 'TOTP' }))
    expect(res.status).toBe(401)
  })

  it('returns 422 when method is missing or invalid (Zod)', async () => {
    mockAuthed()
    let res = await POST(makeRequest({}))
    expect(res.status).toBe(422)

    mockAuthed()
    res = await POST(makeRequest({ method: 'UNKNOWN' }))
    expect(res.status).toBe(422)
  })

  it('returns 400 already_enabled when user has 2FA on', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'TOTP',
    })

    const res = await POST(makeRequest({ method: 'TOTP' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('already_enabled')
  })

  it('TOTP happy path: returns secret, otpauthUri and qrDataUrl', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      identifier: 'u@example.com',
      type: 'EMAIL',
      verified: true,
    })
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})

    const res = await POST(makeRequest({ method: 'TOTP' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.method).toBe('TOTP')
    expect(json.secret).toBe('FAKESECRET123456')
    expect(json.otpauthUri).toContain('otpauth://')
    expect(json.qrDataUrl).toContain('data:image/png;base64,')

    // AuthEvent logged
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          event: 'TWO_FACTOR_SETUP_INITIATED',
          metadata: expect.objectContaining({ method: 'TOTP' }),
        }),
      }),
    )
  })

  it('SMS happy path: returns challengeId and logs event', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      identifier: '+61400000000',
      type: 'PHONE',
      verified: true,
    })
    mockIssueSmsChallenge.mockResolvedValueOnce({ challengeId: 'ch_1' })
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})

    const res = await POST(makeRequest({ method: 'SMS' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.method).toBe('SMS')
    expect(json.challengeId).toBe('ch_1')

    expect(mockIssueSmsChallenge).toHaveBeenCalledWith('u1', '+61400000000')
  })

  it('SMS without verified phone returns 400 phone_not_verified', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ method: 'SMS' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('phone_not_verified')
    expect(mockIssueSmsChallenge).not.toHaveBeenCalled()
  })

  it('TOTP requires verified email identifier for otpauth label', async () => {
    mockAuthed()
    ;(prisma.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    ;(prisma.userIdentifier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ method: 'TOTP' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('email_required')
  })
})
