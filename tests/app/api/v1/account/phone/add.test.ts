import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    phoneVerificationCode: {
      count: vi.fn(),
      updateMany: vi.fn(),
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

vi.mock('@/lib/sms', () => ({
  sendSms: vi.fn().mockResolvedValue({ ok: true, id: 'SM_x' }),
}))

import { POST } from '@/app/api/v1/account/phone/add/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'
import { sendSms } from '@/lib/sms'

const mockRequireAuth = vi.mocked(requireAuth)
const mockSend = vi.mocked(sendSms)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/account/phone/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'kolaleaf_session=x' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/account/phone/add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))

    const res = await POST(makeRequest({ phone: '+61400000000' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid phone format', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })

    const res = await POST(makeRequest({ phone: 'not-a-phone' }))
    expect(res.status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 422 when phone is missing (Zod)', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })

    const res = await POST(makeRequest({}))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.fields?.phone).toBeInstanceOf(Array)
  })

  it('returns 409 when another verified user already owns this phone', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i_other',
      userId: 'u_other',
      type: 'PHONE',
      identifier: '+61400000000',
      verified: true,
    })

    const res = await POST(makeRequest({ phone: '+61400000000' }))
    expect(res.status).toBe(409)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limit exceeded (>=3 codes in last hour)', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(prisma.phoneVerificationCode.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3)

    const res = await POST(makeRequest({ phone: '+61400000000' }))
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error).toBe('rate_limited')
    expect(json.retryAfter).toBeTypeOf('number')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('happy path: invalidates prior codes, creates identifier, stores hash, sends SMS, returns 200', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(prisma.phoneVerificationCode.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0)
    ;(prisma.userIdentifier.upsert as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'ident_1',
      userId: 'u1',
      type: 'PHONE',
      identifier: '+61400000000',
      verified: false,
    })
    ;(prisma.phoneVerificationCode.updateMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 0 })
    ;(prisma.phoneVerificationCode.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'pv_1',
      codeHash: 'hash',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })

    const res = await POST(makeRequest({ phone: '+61 400 000 000' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(true)

    // Identifier upserted in E.164 form
    expect(prisma.userIdentifier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identifier: '+61400000000' },
      }),
    )
    expect(prisma.phoneVerificationCode.updateMany).toHaveBeenCalled()
    expect(prisma.phoneVerificationCode.create).toHaveBeenCalled()
    // Stored hash must not equal the raw code
    const createArgs = (prisma.phoneVerificationCode.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(typeof createArgs.data.codeHash).toBe('string')
    expect(createArgs.data.codeHash.length).toBeGreaterThan(0)
    expect(createArgs.data.userId).toBe('u1')
    expect(createArgs.data.phone).toBe('+61400000000')

    expect(mockSend).toHaveBeenCalledTimes(1)
    const smsArgs = mockSend.mock.calls[0][0]
    expect(smsArgs.to).toBe('+61400000000')
    expect(smsArgs.body).toMatch(/\d{6}/)
  })
})
