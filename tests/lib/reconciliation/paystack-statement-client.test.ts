import { describe, it, expect, vi, afterEach } from 'vitest'
import Decimal from 'decimal.js'

import {
  PaystackStatementClient,
  createPaystackStatementClient,
  validatePaystackStatementConfig,
} from '@/lib/reconciliation/paystack-statement-client'

describe('validatePaystackStatementConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.PAYSTACK_API_URL
    delete process.env.PAYSTACK_SECRET_KEY
  })

  it('throws in production when PAYSTACK_API_URL / PAYSTACK_SECRET_KEY are missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.PAYSTACK_API_URL
    delete process.env.PAYSTACK_SECRET_KEY

    expect(() => validatePaystackStatementConfig()).toThrow(
      /Paystack.*missing/i,
    )
  })

  it('returns isMock=true in dev/test when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.PAYSTACK_API_URL
    delete process.env.PAYSTACK_SECRET_KEY

    const cfg = validatePaystackStatementConfig()
    expect(cfg.isMock).toBe(true)
    expect(cfg.apiKey).toBe('')
  })

  it('returns isMock=false when creds are present', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.PAYSTACK_API_URL = 'https://api.paystack.co'
    process.env.PAYSTACK_SECRET_KEY = 'sk_live_xxx'

    const cfg = validatePaystackStatementConfig()
    expect(cfg.isMock).toBe(false)
    expect(cfg.apiUrl).toBe('https://api.paystack.co')
    expect(cfg.apiKey).toBe('sk_live_xxx')
  })
})

describe('createPaystackStatementClient (factory)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.PAYSTACK_API_URL
    delete process.env.PAYSTACK_SECRET_KEY
  })

  it('returns a mock client that produces [] in dev/test when creds are missing', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.PAYSTACK_API_URL
    delete process.env.PAYSTACK_SECRET_KEY

    const client = createPaystackStatementClient()
    const from = new Date('2026-04-01T00:00:00Z')
    const to = new Date('2026-04-02T00:00:00Z')

    const entries = await client.fetchStatement(from, to)
    expect(entries).toEqual([])
    expect(client.provider).toBe('paystack')
  })

  it('throws in production when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.PAYSTACK_API_URL
    delete process.env.PAYSTACK_SECRET_KEY

    expect(() => createPaystackStatementClient()).toThrow(
      /Paystack.*missing/i,
    )
  })
})

describe('PaystackStatementClient.fetchStatement', () => {
  const baseUrl = 'https://api.paystack.test'
  const apiKey = 'sk_test_xyz'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalises successful transfers (kobo → NGN, Decimal, debit)', async () => {
    // Paystack amounts are in kobo (1/100 NGN). 150_000 kobo → ₦1,500.
    const mockResponse = {
      data: [
        {
          reference: 'PS-REF-1',
          amount: 150000,
          currency: 'NGN',
          transferred_at: '2026-04-15T10:00:00Z',
          status: 'success',
        },
        {
          reference: 'PS-REF-2',
          amount: 4250050,
          currency: 'NGN',
          transferred_at: '2026-04-15T11:30:00Z',
          status: 'success',
        },
      ],
    }

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )

    const client = new PaystackStatementClient(baseUrl, apiKey)
    const from = new Date('2026-04-15T00:00:00Z')
    const to = new Date('2026-04-16T00:00:00Z')

    const entries = await client.fetchStatement(from, to)

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      provider: 'paystack',
      providerRef: 'PS-REF-1',
      currency: 'NGN',
      direction: 'debit',
    })
    // 150000 kobo ÷ 100 = 1500 NGN
    expect(entries[0].amount).toBeInstanceOf(Decimal)
    expect(entries[0].amount.equals(new Decimal('1500'))).toBe(true)
    expect(entries[0].occurredAt).toEqual(new Date('2026-04-15T10:00:00Z'))

    // 4_250_050 kobo ÷ 100 = 42500.50 NGN
    expect(entries[1].amount.equals(new Decimal('42500.50'))).toBe(true)
    expect(entries[1].providerRef).toBe('PS-REF-2')

    // Request shape: bearer auth + /transfer endpoint with date params.
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain(baseUrl)
    expect(String(url)).toContain('transfer')
    expect(String(url)).toContain('from=')
    expect(String(url)).toContain('to=')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${apiKey}`)
  })

  it('filters out non-success entries', async () => {
    const mockResponse = {
      data: [
        {
          reference: 'PS-OK',
          amount: 100000,
          currency: 'NGN',
          transferred_at: '2026-04-15T10:00:00Z',
          status: 'success',
        },
        {
          reference: 'PS-PENDING',
          amount: 200000,
          currency: 'NGN',
          transferred_at: '2026-04-15T10:05:00Z',
          status: 'pending',
        },
        {
          reference: 'PS-FAILED',
          amount: 300000,
          currency: 'NGN',
          transferred_at: '2026-04-15T10:10:00Z',
          status: 'failed',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    )

    const client = new PaystackStatementClient(baseUrl, apiKey)
    const entries = await client.fetchStatement(
      new Date('2026-04-15T00:00:00Z'),
      new Date('2026-04-16T00:00:00Z'),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].providerRef).toBe('PS-OK')
    expect(entries[0].amount.equals(new Decimal('1000'))).toBe(true)
  })
})
