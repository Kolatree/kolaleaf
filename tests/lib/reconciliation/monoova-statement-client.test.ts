import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Decimal from 'decimal.js'
import {
  MonoovaStatementClient,
  validateMonoovaStatementConfig,
} from '@/lib/reconciliation/monoova-statement-client'

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

beforeEach(() => {
  mockFetch.mockReset()
  // Start each test from a clean env to avoid cross-test leakage. Using
  // vi.stubEnv so Vitest restores values after the test (avoids TS errors
  // from NODE_ENV being a readonly literal type in modern @types/node).
  vi.stubEnv('MONOOVA_STATEMENT_API_URL', '')
  vi.stubEnv('MONOOVA_API_KEY', '')
  vi.stubEnv('NODE_ENV', 'test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('validateMonoovaStatementConfig', () => {
  it('throws in production when MONOOVA_STATEMENT_API_URL is missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MONOOVA_API_KEY', 'key')
    expect(() => validateMonoovaStatementConfig()).toThrow(
      /MONOOVA_STATEMENT_API_URL/,
    )
  })

  it('throws in production when MONOOVA_API_KEY is missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MONOOVA_STATEMENT_API_URL', 'https://example.test/api')
    expect(() => validateMonoovaStatementConfig()).toThrow(/MONOOVA_API_KEY/)
  })

  it('returns isMock=true in dev/test when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'test')
    const cfg = validateMonoovaStatementConfig()
    expect(cfg.isMock).toBe(true)
  })

  it('returns live config when both creds are present', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('MONOOVA_STATEMENT_API_URL', 'https://example.test/api')
    vi.stubEnv('MONOOVA_API_KEY', 'secret-key')
    const cfg = validateMonoovaStatementConfig()
    expect(cfg.isMock).toBe(false)
    expect(cfg.apiUrl).toBe('https://example.test/api')
    expect(cfg.apiKey).toBe('secret-key')
  })
})

describe('MonoovaStatementClient', () => {
  it('has provider=monoova', () => {
    const client = new MonoovaStatementClient({
      apiUrl: 'https://example.test/api',
      apiKey: 'k',
    })
    expect(client.provider).toBe('monoova')
  })

  it('returns [] in dev/test when creds are missing (no network call)', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    // No MONOOVA_STATEMENT_API_URL / MONOOVA_API_KEY set.
    const client = MonoovaStatementClient.fromEnv()
    const entries = await client.fetchStatement(
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-04-02T00:00:00Z'),
    )
    expect(entries).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('normalises provider entries to StatementEntry[] on the happy path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entries: [
          {
            reference: 'payid-123',
            amount: 100.0,
            occurredAt: '2026-04-18T00:00:00Z',
            type: 'CREDIT',
          },
          {
            reference: 'payid-456',
            amount: 250.75,
            occurredAt: '2026-04-18T03:15:00Z',
            type: 'CREDIT',
          },
        ],
      }),
    })

    const client = new MonoovaStatementClient({
      apiUrl: 'https://example.test/api',
      apiKey: 'secret',
    })

    const entries = await client.fetchStatement(
      new Date('2026-04-18T00:00:00Z'),
      new Date('2026-04-19T00:00:00Z'),
    )

    expect(entries).toHaveLength(2)

    expect(entries[0].provider).toBe('monoova')
    expect(entries[0].providerRef).toBe('payid-123')
    expect(entries[0].direction).toBe('credit')
    expect(entries[0].currency).toBe('AUD')
    expect(entries[0].amount).toBeInstanceOf(Decimal)
    expect(entries[0].amount.toString()).toBe('100')
    expect(entries[0].occurredAt).toEqual(new Date('2026-04-18T00:00:00Z'))

    expect(entries[1].providerRef).toBe('payid-456')
    expect(entries[1].amount.toString()).toBe('250.75')
    expect(entries[1].direction).toBe('credit')
    expect(entries[1].currency).toBe('AUD')
  })

  it('honours the time window — request includes ISO from/to params and bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: [] }),
    })

    const client = new MonoovaStatementClient({
      apiUrl: 'https://example.test/api',
      apiKey: 'secret',
    })

    const from = new Date('2026-04-01T00:00:00Z')
    const to = new Date('2026-04-02T00:00:00Z')
    await client.fetchStatement(from, to)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(typeof url).toBe('string')
    expect(String(url)).toContain('https://example.test/api/statements')
    expect(String(url)).toContain(`from=${encodeURIComponent(from.toISOString())}`)
    expect(String(url)).toContain(`to=${encodeURIComponent(to.toISOString())}`)
    expect(opts.method ?? 'GET').toBe('GET')
    expect(opts.headers['Authorization']).toBe('Bearer secret')
    // withRetry wires a per-attempt AbortSignal through.
    expect(opts.signal).toBeDefined()
  })
})
