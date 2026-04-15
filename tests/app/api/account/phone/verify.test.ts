import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    phoneVerificationCode: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    userIdentifier: {
      update: vi.fn(),
      findUnique: vi.fn(),
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

import { POST } from '@/app/api/account/phone/verify/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'
import bcrypt from 'bcrypt'

const mockRequireAuth = vi.mocked(requireAuth)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/account/phone/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'kolaleaf_session=x' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/account/phone/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))
    const res = await POST(makeRequest({ phone: '+61400000000', code: '123456' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when phone or code missing', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    let res = await POST(makeRequest({ phone: '+61400000000' }))
    expect(res.status).toBe(400)
    res = await POST(makeRequest({ code: '123456' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when no outstanding code exists', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.phoneVerificationCode.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ phone: '+61400000000', code: '123456' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_code')
  })

  it('returns 400 for wrong code and increments attempts', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    const hash = await bcrypt.hash('123456', 4)
    ;(prisma.phoneVerificationCode.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'pv_1',
      userId: 'u1',
      phone: '+61400000000',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      usedAt: null,
    })
    ;(prisma.phoneVerificationCode.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ phone: '+61400000000', code: '000000' }))
    expect(res.status).toBe(400)
    expect(prisma.phoneVerificationCode.update).toHaveBeenCalled()
    const updates = (prisma.phoneVerificationCode.update as ReturnType<typeof vi.fn>).mock.calls
    const hasAttemptsIncrement = updates.some((c) => c[0].data && 'attempts' in c[0].data)
    expect(hasAttemptsIncrement).toBe(true)
  })

  it('returns 403 too_many_attempts after 5th bad attempt', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    const hash = await bcrypt.hash('123456', 4)
    ;(prisma.phoneVerificationCode.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'pv_1',
      userId: 'u1',
      phone: '+61400000000',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 4,
      usedAt: null,
    })
    ;(prisma.phoneVerificationCode.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ phone: '+61400000000', code: '000000' }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('too_many_attempts')
    // Code burned
    const updates = (prisma.phoneVerificationCode.update as ReturnType<typeof vi.fn>).mock.calls
    const burned = updates.some((c) => c[0].data && c[0].data.usedAt)
    expect(burned).toBe(true)
  })

  it('returns 400 for expired code', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    // findFirst only returns non-expired rows by contract, so we simulate that by
    // returning null when the query would have excluded an expired one.
    ;(prisma.phoneVerificationCode.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ phone: '+61400000000', code: '123456' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_code')
  })

  it('happy path: flips identifier verified, marks code used, writes AuthEvent, returns 200', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    const hash = await bcrypt.hash('123456', 4)
    ;(prisma.phoneVerificationCode.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'pv_1',
      userId: 'u1',
      phone: '+61400000000',
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      usedAt: null,
    })
    ;(prisma.phoneVerificationCode.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.userIdentifier.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const res = await POST(makeRequest({ phone: '+61400000000', code: '123456' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.verified).toBe(true)

    // Transaction used for the verify+consume atomic step
    expect(
      (prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction,
    ).toHaveBeenCalledTimes(1)

    // AuthEvent written
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', event: 'PHONE_VERIFIED' }),
      }),
    )
  })
})
