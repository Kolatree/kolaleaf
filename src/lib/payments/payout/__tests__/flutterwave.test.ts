import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { FlutterwaveProvider } from '../flutterwave'
import {
  InsufficientBalanceError,
  InvalidBankError,
  ProviderTimeoutError,
  RateLimitError,
} from '../types'

const mockFetch = vi.fn()
global.fetch = mockFetch

const provider = new FlutterwaveProvider({
  secretKey: 'FLWSECK_TEST-abc123',
  apiUrl: 'https://api.flutterwave.com/v3',
})

const validParams = {
  transferId: 'txn_001',
  amount: new Decimal('500000.00'),
  currency: 'NGN',
  bankCode: '044',
  accountNumber: '0690000031',
  recipientName: 'John Doe',
  reference: 'KL-PO-txn_001-1700000000000',
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('FlutterwaveProvider', () => {
  it('has the correct name', () => {
    expect(provider.name).toBe('FLUTTERWAVE')
  })

  describe('initiatePayout', () => {
    it('sends a successful NGN transfer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            id: 12345,
            reference: validParams.reference,
            status: 'NEW',
          },
        }),
      })

      const result = await provider.initiatePayout(validParams)

      expect(result.providerRef).toBe('12345')
      expect(result.status).toBe('NEW')

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.flutterwave.com/v3/transfers')
      expect(opts.method).toBe('POST')
      expect(opts.headers['Authorization']).toBe('Bearer FLWSECK_TEST-abc123')
      expect(opts.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(opts.body)
      expect(body.account_bank).toBe('044')
      expect(body.account_number).toBe('0690000031')
      expect(body.amount).toBe(500000)
      expect(body.currency).toBe('NGN')
      expect(body.reference).toBe(validParams.reference)
      expect(body.narration).toContain('John Doe')
    })

    it('throws InsufficientBalanceError when balance is low', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Insufficient balance',
        }),
      })

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(
        InsufficientBalanceError,
      )
    })

    it('throws InvalidBankError for invalid bank code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Invalid bank code passed',
        }),
      })

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(
        InvalidBankError,
      )
    })

    it('throws ProviderTimeoutError on fetch timeout', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      mockFetch.mockRejectedValueOnce(abortError)

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(
        ProviderTimeoutError,
      )
    })

    it('throws RateLimitError on 429 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          status: 'error',
          message: 'Rate limit exceeded',
        }),
      })

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(
        RateLimitError,
      )
    })
  })

  describe('getPayoutStatus', () => {
    it('returns status for a valid transfer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            status: 'SUCCESSFUL',
          },
        }),
      })

      const result = await provider.getPayoutStatus('12345')

      expect(result.status).toBe('SUCCESSFUL')
      expect(result.failureReason).toBeUndefined()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.flutterwave.com/v3/transfers/12345',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('returns failure reason when transfer failed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            status: 'FAILED',
            complete_message: 'Transfer failed due to invalid account',
          },
        }),
      })

      const result = await provider.getPayoutStatus('12345')

      expect(result.status).toBe('FAILED')
      expect(result.failureReason).toBe('Transfer failed due to invalid account')
    })
  })

  describe('getWalletBalance', () => {
    it('returns the NGN wallet balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: [
            { currency: 'NGN', available_balance: 1500000.5 },
            { currency: 'USD', available_balance: 1000 },
          ],
        }),
      })

      const balance = await provider.getWalletBalance('NGN')

      expect(balance.toString()).toBe('1500000.5')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.flutterwave.com/v3/balances/NGN',
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })
})
