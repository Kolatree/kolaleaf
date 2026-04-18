import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'

// Mock every external — this test is about the orchestrator's
// coordination, not the individual clients (which have their own
// tests) or the diff engine (same).
vi.mock('@/lib/db/client', () => ({
  prisma: {
    transfer: { findMany: vi.fn() },
    complianceReport: { create: vi.fn() },
  },
}))
vi.mock('@/lib/obs/logger', () => ({ log: vi.fn() }))
vi.mock('@/lib/reconciliation/monoova-statement-client', () => ({
  MonoovaStatementClient: {
    fromEnv: vi.fn(() => ({
      provider: 'monoova',
      fetchStatement: vi.fn(),
    })),
  },
}))
vi.mock('@/lib/reconciliation/flutterwave-statement-client', () => ({
  createFlutterwaveStatementClient: vi.fn(() => ({
    provider: 'flutterwave',
    fetchStatement: vi.fn(),
  })),
}))
vi.mock('@/lib/reconciliation/paystack-statement-client', () => ({
  createPaystackStatementClient: vi.fn(() => ({
    provider: 'paystack',
    fetchStatement: vi.fn(),
  })),
}))

import { GET, POST } from '@/app/api/cron/provider-reconciliation/route'
import { prisma } from '@/lib/db/client'
import { MonoovaStatementClient } from '@/lib/reconciliation/monoova-statement-client'
import { createFlutterwaveStatementClient } from '@/lib/reconciliation/flutterwave-statement-client'
import { createPaystackStatementClient } from '@/lib/reconciliation/paystack-statement-client'

const mockFindMany = vi.mocked(prisma.transfer.findMany)
const mockCreate = vi.mocked(prisma.complianceReport.create)

function makeClient(provider: string, entries: unknown[] = []) {
  return {
    provider,
    fetchStatement: vi.fn().mockResolvedValue(entries),
  }
}

const req = (hasAuth = false) =>
  new Request('http://localhost/api/cron/provider-reconciliation', {
    method: 'POST',
    headers: hasAuth ? { authorization: 'Bearer test-secret' } : {},
  })

describe('GET/POST /api/cron/provider-reconciliation', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CRON_SECRET
    mockFindMany.mockResolvedValue([])
    mockCreate.mockResolvedValue({} as never)
    vi.mocked(MonoovaStatementClient.fromEnv).mockReturnValue(
      makeClient('monoova') as never,
    )
    vi.mocked(createFlutterwaveStatementClient).mockReturnValue(
      makeClient('flutterwave') as never,
    )
    vi.mocked(createPaystackStatementClient).mockReturnValue(
      makeClient('paystack') as never,
    )
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it('returns 200 with zero discrepancies when statements and ledger are empty', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      discrepancies: number
      providers: { provider: string; entries: number }[]
    }
    expect(json.discrepancies).toBe(0)
    expect(json.providers).toHaveLength(3)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET is set and auth header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const res = await POST(req(false))
    expect(res.status).toBe(401)
  })

  it('accepts matching Bearer token', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const res = await POST(req(true))
    expect(res.status).toBe(200)
  })

  it('creates a SUSPICIOUS ComplianceReport per discrepancy', async () => {
    vi.mocked(MonoovaStatementClient.fromEnv).mockReturnValue(
      makeClient('monoova', [
        {
          provider: 'monoova',
          providerRef: 'payid-unknown',
          amount: new Decimal('100'),
          currency: 'AUD',
          occurredAt: new Date(),
          direction: 'credit',
        },
      ]) as never,
    )
    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { discrepancies: number; discrepancyBreakdown: Record<string, number> }
    expect(json.discrepancies).toBe(1)
    expect(json.discrepancyBreakdown.missing_in_ledger).toBe(1)
    expect(mockCreate).toHaveBeenCalledOnce()
    const call = mockCreate.mock.calls[0][0].data
    expect(call.type).toBe('SUSPICIOUS')
    expect((call.details as { source?: string }).source).toBe('provider_reconciliation')
  })

  it('continues when one provider throws — logs + reports from the others still run', async () => {
    const failing = {
      provider: 'monoova',
      fetchStatement: vi.fn().mockRejectedValue(new Error('Monoova down')),
    }
    vi.mocked(MonoovaStatementClient.fromEnv).mockReturnValue(failing as never)
    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      providers: { provider: string; error?: string }[]
    }
    const monoovaResult = json.providers.find((p) => p.provider === 'monoova')
    expect(monoovaResult?.error).toContain('Monoova down')
    // Other providers still fetched
    expect(json.providers).toHaveLength(3)
  })

  it('also handles GET (Railway cron schedulers use either method)', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/provider-reconciliation'),
    )
    expect(res.status).toBe(200)
  })

  it('swallows ComplianceReport write failures — broken compliance pipe cannot fail the cron', async () => {
    vi.mocked(MonoovaStatementClient.fromEnv).mockReturnValue(
      makeClient('monoova', [
        {
          provider: 'monoova',
          providerRef: 'payid-x',
          amount: new Decimal('100'),
          currency: 'AUD',
          occurredAt: new Date(),
          direction: 'credit',
        },
      ]) as never,
    )
    mockCreate.mockRejectedValueOnce(new Error('DB offline'))
    const res = await POST(req())
    // Still 200 — signal survived via the log path
    expect(res.status).toBe(200)
  })
})

import { afterAll } from 'vitest'
