import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { GET } from '@/app/api/health/route'
import { prisma } from '@/lib/db/client'

const mockQuery = vi.mocked(prisma.$queryRaw)

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.REDIS_URL
  })

  it('returns 200 { ok: true } when DB is reachable (no REDIS_URL in dev)', async () => {
    mockQuery.mockResolvedValue([{ '?column?': 1 }])
    const res = await GET()
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; checks: { db: { ok: boolean } } }
    expect(json.ok).toBe(true)
    expect(json.checks.db.ok).toBe(true)
  })

  it('returns 503 when DB check throws', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'))
    const res = await GET()
    expect(res.status).toBe(503)
    const json = (await res.json()) as { ok: boolean; checks: { db: { ok: boolean; error: string } } }
    expect(json.ok).toBe(false)
    expect(json.checks.db.ok).toBe(false)
    expect(json.checks.db.error).toContain('connection refused')
  })
})
