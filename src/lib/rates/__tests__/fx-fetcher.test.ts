import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { DefaultFxRateProvider } from '../fx-fetcher'

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

    it('throws on API error response (non-ok status)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toThrow(
        'FX API error: 401 Unauthorized',
      )
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

    it('throws on fetch timeout (AbortError)', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      mockFetch.mockRejectedValueOnce(abortError)

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toThrow(
        'FX API request timed out',
      )
    })

    it('re-throws unexpected fetch errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      await expect(provider.fetchWholesaleRate('AUD', 'NGN')).rejects.toThrow(
        'Network failure',
      )
    })
  })
})
