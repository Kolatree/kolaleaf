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
    complianceReport: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))
vi.mock('@/lib/auth/audit', () => ({
  logAuthEvent: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/v1/admin/compliance/[id]/mark-reported/route'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { prisma } from '@/lib/db/client'
import { logAuthEvent } from '@/lib/auth/audit'

const mockAdmin = vi.mocked(requireAdmin)
const mockFind = vi.mocked(prisma.complianceReport.findUnique)
const mockUpdate = vi.mocked(prisma.complianceReport.update)
const mockLog = vi.mocked(logAuthEvent)

const makeRow = (over: Partial<{ reportedAt: Date | null; austracRef: string | null }> = {}) => ({
  id: 'cr1',
  type: 'THRESHOLD',
  transferId: 't1',
  userId: 'u1',
  details: {},
  reportedAt: over.reportedAt ?? null,
  austracRef: over.austracRef ?? null,
  createdAt: new Date(),
})

const req = (body: unknown = { austracRef: 'AUSTRAC-12345' }) =>
  new Request('http://localhost/api/v1/admin/compliance/cr1/mark-reported', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/v1/admin/compliance/[id]/mark-reported', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdmin.mockResolvedValue({ userId: 'admin-1' })
  })

  it('returns 404 when the report id is unknown', async () => {
    mockFind.mockResolvedValue(null)
    const res = await POST(req(), { params: Promise.resolve({ id: 'cr1' }) })
    expect(res.status).toBe(404)
  })

  it('marks the row reported and writes an admin AuthEvent', async () => {
    mockFind.mockResolvedValue(makeRow() as never)
    mockUpdate.mockResolvedValue({
      ...makeRow(),
      reportedAt: new Date(),
      austracRef: 'AUSTRAC-12345',
    } as never)
    const res = await POST(req(), { params: Promise.resolve({ id: 'cr1' }) })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { austracRef: string }
    expect(json.austracRef).toBe('AUSTRAC-12345')
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ADMIN_COMPLIANCE_MARK_REPORTED' }),
    )
  })

  it('is idempotent — second mark preserves original austracRef', async () => {
    mockFind.mockResolvedValue(
      makeRow({ reportedAt: new Date('2026-04-10'), austracRef: 'ORIGINAL-REF' }) as never,
    )
    const res = await POST(req({ austracRef: 'NEW-REF' }), {
      params: Promise.resolve({ id: 'cr1' }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { austracRef: string }
    expect(json.austracRef).toBe('ORIGINAL-REF')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when austracRef is missing', async () => {
    mockFind.mockResolvedValue(makeRow() as never)
    const res = await POST(req({}), { params: Promise.resolve({ id: 'cr1' }) })
    expect(res.status).toBe(422)
  })
})
