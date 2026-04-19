import { describe, it, expect, vi, afterEach } from 'vitest'
import Decimal from 'decimal.js'

import {
  BudPayStatementClient,
  createBudPayStatementClient,
  validateBudPayStatementConfig,
} from '@/lib/reconciliation/budpay-statement-client'

describe('validateBudPayStatementConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.BUDPAY_API_URL
    delete process.env.BUDPAY_SECRET_KEY
  })

  it('throws in production when BUDPAY_API_URL / BUDPAY_SECRET_KEY are missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.BUDPAY_API_URL
    delete process.env.BUDPAY_SECRET_KEY

    expect(() => validateBudPayStatementConfig()).toThrow(/BudPay.*missing/i)
  })

  it('returns isMock=true in dev/test when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.BUDPAY_API_URL
    delete process.env.BUDPAY_SECRET_KEY

    const cfg = validateBudPayStatementConfig()
    expect(cfg.isMock).toBe(true)
    expect(cfg.apiKey).toBe('')
  })

  it('returns isMock=false when creds are present', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.BUDPAY_API_URL = 'https://api.budpay.com'
    process.env.BUDPAY_SECRET_KEY = 'sk_live_xxx'

    const cfg = validateBudPayStatementConfig()
    expect(cfg.isMock).toBe(false)
    expect(cfg.apiUrl).toBe('https://api.budpay.com')
    expect(cfg.apiKey).toBe('sk_live_xxx')
  })
})

describe('createBudPayStatementClient (factory)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.BUDPAY_API_URL
    delete process.env.BUDPAY_SECRET_KEY
  })

  it('returns a mock client that produces [] in dev/test when creds are missing', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.BUDPAY_API_URL
    delete process.env.BUDPAY_SECRET_KEY

    const client = createBudPayStatementClient()
    const from = new Date('2026-04-01T00:00:00Z')
    const to = new Date('2026-04-02T00:00:00Z')

    const entries = await client.fetchStatement(from, to)
    expect(entries).toEqual([])
    expect(client.provider).toBe('budpay')
  })

  it('throws in production when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.BUDPAY_API_URL
    delete process.env.BUDPAY_SECRET_KEY

    expect(() => createBudPayStatementClient()).toThrow(/BudPay.*missing/i)
  })
})

describe('BudPayStatementClient.fetchStatement', () => {
  const baseUrl = 'https://api.budpay.test'
  const apiKey = 'sk_test_xyz'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalises successful transfers (major units, Decimal, debit)', async () => {
    const mockResponse = {
      data: [
        {
          reference: 'BP-REF-1',
          amount: '1500',
          currency: 'NGN',
          transferred_at: '2026-04-15T10:00:00Z',
          status: 'success',
        },
        {
          reference: 'BP-REF-2',
          amount: '42500.50',
          currency: 'NGN',
          transferred_at: '2026-04-15T11:30:00Z',
          status: 'success',
        },
      ],
    }

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), { status: 200 }))

    const client = new BudPayStatementClient(baseUrl, apiKey)
    const from = new Date('2026-04-15T00:00:00Z')
    const to = new Date('2026-04-16T00:00:00Z')

    const entries = await client.fetchStatement(from, to)

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      provider: 'budpay',
      providerRef: 'BP-REF-1',
      currency: 'NGN',
      direction: 'debit',
    })
    expect(entries[0].amount).toBeInstanceOf(Decimal)
    expect(entries[0].amount.equals(new Decimal('1500'))).toBe(true)
    expect(entries[0].occurredAt).toEqual(new Date('2026-04-15T10:00:00Z'))

    expect(entries[1].amount.equals(new Decimal('42500.50'))).toBe(true)
    expect(entries[1].providerRef).toBe('BP-REF-2')

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain(baseUrl)
    expect(String(url)).toContain('list_transfers')
    expect(String(url)).toContain('from=')
    expect(String(url)).toContain('to=')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${apiKey}`)
  })

  it('filters out non-success entries', async () => {
    const mockResponse = {
      data: [
        {
          reference: 'BP-OK',
          amount: '1000',
          currency: 'NGN',
          transferred_at: '2026-04-15T10:00:00Z',
          status: 'success',
        },
        {
          reference: 'BP-PENDING',
          amount: '2000',
          currency: 'NGN',
          transferred_at: '2026-04-15T10:05:00Z',
          status: 'pending',
        },
        {
          reference: 'BP-FAILED',
          amount: '3000',
          currency: 'NGN',
          transferred_at: '2026-04-15T10:10:00Z',
          status: 'failed',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    )

    const client = new BudPayStatementClient(baseUrl, apiKey)
    const entries = await client.fetchStatement(
      new Date('2026-04-15T00:00:00Z'),
      new Date('2026-04-16T00:00:00Z'),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].providerRef).toBe('BP-OK')
    expect(entries[0].amount.equals(new Decimal('1000'))).toBe(true)
  })
})
