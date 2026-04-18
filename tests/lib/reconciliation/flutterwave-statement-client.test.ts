import { describe, it, expect, vi, afterEach } from 'vitest'
import Decimal from 'decimal.js'

import {
  FlutterwaveStatementClient,
  createFlutterwaveStatementClient,
  validateFlutterwaveStatementConfig,
} from '@/lib/reconciliation/flutterwave-statement-client'

describe('validateFlutterwaveStatementConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.FLUTTERWAVE_API_URL
    delete process.env.FLUTTERWAVE_SECRET_KEY
  })

  it('throws in production when FLUTTERWAVE_API_URL / FLUTTERWAVE_SECRET_KEY are missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.FLUTTERWAVE_API_URL
    delete process.env.FLUTTERWAVE_SECRET_KEY

    expect(() => validateFlutterwaveStatementConfig()).toThrow(
      /Flutterwave.*missing/i,
    )
  })

  it('returns isMock=true in dev/test when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.FLUTTERWAVE_API_URL
    delete process.env.FLUTTERWAVE_SECRET_KEY

    const cfg = validateFlutterwaveStatementConfig()
    expect(cfg.isMock).toBe(true)
    expect(cfg.apiKey).toBe('')
  })

  it('returns isMock=false when creds are present', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.FLUTTERWAVE_API_URL = 'https://api.flutterwave.com/v3'
    process.env.FLUTTERWAVE_SECRET_KEY = 'flw-live-key'

    const cfg = validateFlutterwaveStatementConfig()
    expect(cfg.isMock).toBe(false)
    expect(cfg.apiUrl).toBe('https://api.flutterwave.com/v3')
    expect(cfg.apiKey).toBe('flw-live-key')
  })
})

describe('createFlutterwaveStatementClient (factory)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.FLUTTERWAVE_API_URL
    delete process.env.FLUTTERWAVE_SECRET_KEY
  })

  it('returns a mock client that produces [] in dev/test when creds are missing', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.FLUTTERWAVE_API_URL
    delete process.env.FLUTTERWAVE_SECRET_KEY

    const client = createFlutterwaveStatementClient()
    const from = new Date('2026-04-01T00:00:00Z')
    const to = new Date('2026-04-02T00:00:00Z')

    const entries = await client.fetchStatement(from, to)
    expect(entries).toEqual([])
    expect(client.provider).toBe('flutterwave')
  })

  it('throws in production when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.FLUTTERWAVE_API_URL
    delete process.env.FLUTTERWAVE_SECRET_KEY

    expect(() => createFlutterwaveStatementClient()).toThrow(
      /Flutterwave.*missing/i,
    )
  })
})

describe('FlutterwaveStatementClient.fetchStatement', () => {
  const baseUrl = 'https://api.flutterwave.test/v3'
  const apiKey = 'flw-secret'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalises successful transfers into StatementEntry[] (debit, NGN, Decimal amount)', async () => {
    const mockResponse = {
      data: [
        {
          reference: 'FLW-REF-1',
          amount: 150000,
          currency: 'NGN',
          created_at: '2026-04-15T10:00:00Z',
          status: 'SUCCESSFUL',
        },
        {
          reference: 'FLW-REF-2',
          amount: 42500.5,
          currency: 'NGN',
          created_at: '2026-04-15T11:30:00Z',
          status: 'SUCCESSFUL',
        },
      ],
    }

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )

    const client = new FlutterwaveStatementClient(baseUrl, apiKey)
    const from = new Date('2026-04-15T00:00:00Z')
    const to = new Date('2026-04-16T00:00:00Z')

    const entries = await client.fetchStatement(from, to)

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      provider: 'flutterwave',
      providerRef: 'FLW-REF-1',
      currency: 'NGN',
      direction: 'debit',
    })
    expect(entries[0].amount).toBeInstanceOf(Decimal)
    expect(entries[0].amount.equals(new Decimal('150000'))).toBe(true)
    expect(entries[0].occurredAt).toEqual(new Date('2026-04-15T10:00:00Z'))

    expect(entries[1].amount.equals(new Decimal('42500.5'))).toBe(true)
    expect(entries[1].providerRef).toBe('FLW-REF-2')

    // Request shape: bearer auth + date query params.
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain(baseUrl)
    expect(String(url)).toContain('transfers')
    expect(String(url)).toContain('from=')
    expect(String(url)).toContain('to=')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${apiKey}`)
  })

  it('filters out non-SUCCESSFUL entries', async () => {
    const mockResponse = {
      data: [
        {
          reference: 'FLW-OK',
          amount: 1000,
          currency: 'NGN',
          created_at: '2026-04-15T10:00:00Z',
          status: 'SUCCESSFUL',
        },
        {
          reference: 'FLW-PENDING',
          amount: 2000,
          currency: 'NGN',
          created_at: '2026-04-15T10:05:00Z',
          status: 'PENDING',
        },
        {
          reference: 'FLW-FAILED',
          amount: 3000,
          currency: 'NGN',
          created_at: '2026-04-15T10:10:00Z',
          status: 'FAILED',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    )

    const client = new FlutterwaveStatementClient(baseUrl, apiKey)
    const entries = await client.fetchStatement(
      new Date('2026-04-15T00:00:00Z'),
      new Date('2026-04-16T00:00:00Z'),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].providerRef).toBe('FLW-OK')
  })
})
