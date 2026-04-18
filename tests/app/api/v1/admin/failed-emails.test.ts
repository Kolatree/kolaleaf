import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/admin-middleware', () => ({
  requireAdmin: vi.fn(),
}))
vi.mock('@/lib/auth/middleware', () => ({
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
    failedEmail: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { GET as ListGET } from '@/app/api/v1/admin/failed-emails/route'
import { POST as ResolvePOST } from '@/app/api/v1/admin/failed-emails/[id]/resolve/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

const mockAdmin = vi.mocked(requireAdmin)
const mockFindMany = vi.mocked(prisma.failedEmail.findMany)
const mockFindUnique = vi.mocked(prisma.failedEmail.findUnique)
const mockUpdate = vi.mocked(prisma.failedEmail.update)

const makeRow = (over: Partial<{ id: string; resolvedAt: Date | null }> = {}) => ({
  id: over.id ?? 'fe1',
  toEmail: 'u@x.com',
  template: 'verification_code',
  payloadHash: 'h',
  attempts: 8,
  lastError: 'rate limited',
  failedAt: new Date('2026-04-17T00:00:00Z'),
  resolvedAt: over.resolvedAt ?? null,
  resolvedBy: null,
})

describe('GET /api/v1/admin/failed-emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdmin.mockResolvedValue({ userId: 'admin-1' })
  })

  it('returns 403 for non-admin', async () => {
    mockAdmin.mockRejectedValue(new AuthError(403, 'Admin access required'))
    const res = await ListGET(new Request('http://localhost/api/v1/admin/failed-emails'))
    expect(res.status).toBe(403)
  })

  it('returns items and nextCursor=null when fewer than limit', async () => {
    mockFindMany.mockResolvedValue([makeRow()] as never)
    const res = await ListGET(new Request('http://localhost/api/v1/admin/failed-emails'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: unknown[]; nextCursor: string | null }
    expect(json.items).toHaveLength(1)
    expect(json.nextCursor).toBeNull()
  })

  it('sets nextCursor when there are more than limit rows', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => makeRow({ id: `fe${i}` }))
    mockFindMany.mockResolvedValue(rows as never)
    const res = await ListGET(
      new Request('http://localhost/api/v1/admin/failed-emails?limit=2'),
    )
    const json = (await res.json()) as { items: unknown[]; nextCursor: string | null }
    expect(json.items).toHaveLength(2)
    expect(json.nextCursor).toBe('fe1')
  })

  it('filters by resolved=true', async () => {
    mockFindMany.mockResolvedValue([] as never)
    await ListGET(
      new Request('http://localhost/api/v1/admin/failed-emails?resolved=true'),
    )
    expect(mockFindMany.mock.calls[0][0]).toMatchObject({
      where: { resolvedAt: { not: null } },
    })
  })
})

describe('POST /api/v1/admin/failed-emails/[id]/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdmin.mockResolvedValue({ userId: 'admin-1' })
  })

  const req = () =>
    new Request('http://localhost/api/v1/admin/failed-emails/fe1/resolve', {
      method: 'POST',
    })

  it('returns 404 when the id is unknown', async () => {
    mockFindUnique.mockResolvedValue(null)
    const res = await ResolvePOST(req(), { params: Promise.resolve({ id: 'fe1' }) })
    expect(res.status).toBe(404)
  })

  it('marks the row resolved and sets resolvedBy', async () => {
    mockFindUnique.mockResolvedValue(makeRow() as never)
    mockUpdate.mockResolvedValue({
      ...makeRow(),
      resolvedAt: new Date(),
      resolvedBy: 'admin-1',
    } as never)
    const res = await ResolvePOST(req(), { params: Promise.resolve({ id: 'fe1' }) })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { resolvedBy: string }
    expect(json.resolvedBy).toBe('admin-1')
  })

  it('is idempotent — second resolve preserves original resolvedBy', async () => {
    mockFindUnique.mockResolvedValue(
      makeRow({ resolvedAt: new Date('2026-04-10') }) as never,
    )
    // Simulate another admin trying to resolve
    mockAdmin.mockResolvedValue({ userId: 'admin-2' })
    const originalResolvedBy = 'admin-1'
    mockFindUnique.mockResolvedValue({
      ...makeRow({ resolvedAt: new Date('2026-04-10') }),
      resolvedBy: originalResolvedBy,
    } as never)
    const res = await ResolvePOST(req(), { params: Promise.resolve({ id: 'fe1' }) })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { resolvedBy: string }
    expect(json.resolvedBy).toBe(originalResolvedBy)
    // And we must NOT have called update a second time
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
