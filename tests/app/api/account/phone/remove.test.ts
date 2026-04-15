import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userIdentifier: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
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

import { POST } from '@/app/api/account/phone/remove/route'
import { prisma } from '@/lib/db/client'
import { requireAuth } from '@/lib/auth/middleware'

const mockRequireAuth = vi.mocked(requireAuth)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/account/phone/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'kolaleaf_session=x' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/account/phone/remove', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/auth/middleware')
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, 'Authentication required'))
    const res = await POST(makeRequest({ phone: '+61400000000' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when phone missing', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 cannot_remove_phone_while_2fa_active when user has SMS 2FA enabled', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'SMS',
    })

    const res = await POST(makeRequest({ phone: '+61400000000' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('cannot_remove_phone_while_2fa_active')
    expect(prisma.userIdentifier.delete).not.toHaveBeenCalled()
  })

  it('returns 404 when identifier not found on this user', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ phone: '+61400000000' }))
    expect(res.status).toBe(404)
  })

  it('happy path: deletes identifier, writes PHONE_REMOVED AuthEvent, returns 200', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      userId: 'u1',
      session: { id: 's1', userId: 'u1' } as never,
    })
    ;(prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      twoFactorMethod: 'NONE',
    })
    ;(prisma.userIdentifier.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'ident_1',
      userId: 'u1',
      type: 'PHONE',
      identifier: '+61400000000',
      verified: true,
    })
    ;(prisma.userIdentifier.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})
    ;(prisma.authEvent.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})

    const res = await POST(makeRequest({ phone: '+61 400 000 000' }))
    expect(res.status).toBe(200)

    expect(prisma.userIdentifier.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ident_1' } }),
    )
    expect(prisma.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', event: 'PHONE_REMOVED' }),
      }),
    )
  })
})
