import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Decimal from 'decimal.js'
import { DefaultFxRateProvider, validateFxConfig } from '../fx-fetcher'
import {
  ProviderPermanentError,
  ProviderTemporaryError,
  ProviderTimeoutError,
} from '@/lib/http/retry'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

describe('DefaultFxRateProvider', () => {
  const provider = new DefaultFxRateProvider({
    apiKey: 'test-api-key-123',
    apiUrl: 'https://api.exchangerate.test/v1',
  })

  it('has the correct name', () => {
    expect(provider.name).toBe('default-fx')
  })

  describe('fetchWholesaleRate', () => {
    it('fetches a successful AUD to NGN rate', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          rates: { NGN: 950.1234 },
        }),
      })

      const rate = await provider.fetchWholesaleRate('AUD', 'NGN')

      expect(rate).toBeInstanceOf(Decimal)
      expect(rate.toString()).toBe('950.1234')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('https://api.exchangerate.test/v1')
      expect(url).toContain('base=AUD')
      expect(url).toContain('symbols=NGN')
      expect(url).toContain('apikey=test-api-key-123')
    })

    it('throws ProviderPermanentError on 4xx (no retry)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toBeInstanceOf(
        ProviderPermanentError,
      )
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('retries 5xx then surfaces ProviderTemporaryError', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      })

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toBeInstanceOf(
        ProviderTemporaryError,
      )
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('throws on invalid response (missing rates)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          rates: {},
        }),
      })

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toThrow(
        'No rate returned for NGN',
      )
    })

    it('throws on invalid response (rates is null)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          rates: null,
        }),
      })

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toThrow(
        'No rate returned for NGN',
      )
    })

    it('retries on fetch AbortError then surfaces ProviderTimeoutError', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      mockFetch.mockRejectedValue(abortError)

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toBeInstanceOf(
        ProviderTimeoutError,
      )
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('retries on generic network failure then surfaces ProviderTemporaryError', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'))

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toBeInstanceOf(
        ProviderTemporaryError,
      )
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })
})

describe('validateFxConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.FX_API_KEY
    delete process.env.FX_API_URL
  })

  it('throws in production when FX_API_KEY/FX_API_URL are missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.FX_API_KEY
    delete process.env.FX_API_URL

    expect(() => validateFxConfig()).toThrow(
      /FX rate provider config missing/,
    )
  })

  it('returns isMock=true in dev when creds are missing', () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.FX_API_KEY
    delete process.env.FX_API_URL

    const cfg = validateFxConfig()
    expect(cfg.isMock).toBe(true)
  })

  it('returns isMock=false when creds are present', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.FX_API_KEY = 'key'
    process.env.FX_API_URL = 'https://api.example.com'

    const cfg = validateFxConfig()
    expect(cfg.isMock).toBe(false)
  })
})
