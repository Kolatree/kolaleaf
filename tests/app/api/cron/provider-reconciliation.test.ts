import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'

// Mock every external — this test is about the orchestrator's
// coordination, not the individual clients (which have their own
// tests) or the diff engine (same).
vi.mock('@/lib/db/client', () => ({
  prisma: {
    transfer: { findMany: vi.fn() },
    complianceReport: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
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
const mockReportsFindMany = vi.mocked(prisma.complianceReport.findMany)

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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    // Default posture for each test: no CRON_SECRET (auth-check
    // skipped in non-production), NODE_ENV=test.
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('NODE_ENV', 'test')
    mockFindMany.mockResolvedValue([])
    mockCreate.mockResolvedValue({} as never)
    mockReportsFindMany.mockResolvedValue([] as never)
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
    vi.unstubAllEnvs()
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
    vi.stubEnv('CRON_SECRET', 'test-secret')
    const res = await POST(req(false))
    expect(res.status).toBe(401)
  })

  it('accepts matching Bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret')
    const res = await POST(req(true))
    expect(res.status).toBe(200)
  })

  it('fails closed (503) in production when CRON_SECRET is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CRON_SECRET', '')
    const res = await POST(req(false))
    expect(res.status).toBe(503)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('cron_secret_unset')
    // Recon side-effects must not run when auth fails
    expect(mockFindMany).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
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

  it('skips discrepancies whose (kind, provider, ref) already exists in the window (idempotency)', async () => {
    vi.mocked(MonoovaStatementClient.fromEnv).mockReturnValue(
      makeClient('monoova', [
        {
          provider: 'monoova',
          providerRef: 'payid-dup',
          amount: new Decimal('100'),
          currency: 'AUD',
          occurredAt: new Date(),
          direction: 'credit',
        },
      ]) as never,
    )
    // Simulate a previous run having already recorded this same
    // discrepancy inside the current 24h window.
    mockReportsFindMany.mockResolvedValue([
      {
        details: {
          source: 'provider_reconciliation',
          kind: 'missing_in_ledger',
          provider: 'monoova',
          providerRef: 'payid-dup',
        },
      },
    ] as never)
    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { discrepancies: number }
    expect(json.discrepancies).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('suppresses missing_in_statement when a provider fetch errored', async () => {
    const failing = {
      provider: 'monoova',
      fetchStatement: vi.fn().mockRejectedValue(new Error('Monoova down')),
    }
    vi.mocked(MonoovaStatementClient.fromEnv).mockReturnValue(failing as never)
    // Transfer that WOULD normally be flagged missing_in_statement
    // against Monoova — but Monoova fetch failed so we cannot
    // honestly assert absence.
    mockFindMany.mockResolvedValue([
      {
        id: 'tr_1',
        userId: 'u_1',
        payidProviderRef: 'payid-live',
        payoutProviderRef: null,
        payoutProvider: null,
        sendAmount: new Decimal('100'),
        receiveAmount: new Decimal('100000'),
        sendCurrency: 'AUD',
        receiveCurrency: 'NGN',
        status: 'AUD_RECEIVED',
      },
    ] as never)
    const res = await POST(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { discrepancies: number }
    expect(json.discrepancies).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns sanitized "fetch_failed" in response body but keeps detail in logs', async () => {
    const failing = {
      provider: 'monoova',
      fetchStatement: vi
        .fn()
        .mockRejectedValue(new Error('Bearer leaked-secret-do-not-show')),
    }
    vi.mocked(MonoovaStatementClient.fromEnv).mockReturnValue(failing as never)
    const res = await POST(req())
    expect(res.status).toBe(200)
    const body = await res.text()
    // Sanitized token, not the raw error message
    expect(body).toContain('"error":"fetch_failed"')
    expect(body).not.toContain('leaked-secret-do-not-show')
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
    expect(monoovaResult?.error).toBe('fetch_failed')
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

  it('scopes the transfer query to the 14-day lookback window', async () => {
    await POST(req())
    expect(mockFindMany).toHaveBeenCalledOnce()
    const args = mockFindMany.mock.calls[0][0] as {
      where: { updatedAt: { gte: Date } }
    }
    expect(args.where.updatedAt.gte).toBeInstanceOf(Date)
    const ageMs = Date.now() - args.where.updatedAt.gte.getTime()
    // 14 days ± 1 minute for test runtime slack
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000
    expect(ageMs).toBeGreaterThan(fourteenDaysMs - 60_000)
    expect(ageMs).toBeLessThan(fourteenDaysMs + 60_000)
  })
})
