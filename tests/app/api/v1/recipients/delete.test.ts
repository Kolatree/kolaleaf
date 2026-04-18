import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  AuthError: class extends Error {
    statusCode: number
    constructor(statusCode: number, msg: string) {
      super(msg)
      this.name = 'AuthError'
      this.statusCode = statusCode
    }
  },
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    recipient: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { DELETE } from '@/app/api/v1/recipients/[id]/route'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

const mockAuth = vi.mocked(requireAuth)
const mockFind = vi.mocked(prisma.recipient.findUnique)
const mockDelete = vi.mocked(prisma.recipient.delete)

function req(): Request {
  return new Request('http://localhost/api/v1/recipients/r1', { method: 'DELETE' })
}

describe('DELETE /api/v1/recipients/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 on AuthError', async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, 'Unauthenticated'))
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when recipient is not found', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFind.mockResolvedValueOnce(null)
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when recipient belongs to another user', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFind.mockResolvedValueOnce({ id: 'r1', userId: 'u2' } as never)
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 200 on successful delete', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as never)
    mockFind.mockResolvedValueOnce({ id: 'r1', userId: 'u1' } as never)
    mockDelete.mockResolvedValueOnce({} as never)
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(200)
  })
})
