import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { PaystackProvider } from '../paystack'
import { PayoutError } from '../types'

const mockFetch = vi.fn()
global.fetch = mockFetch

const provider = new PaystackProvider({
  secretKey: 'sk_test_abc123',
  apiUrl: 'https://api.paystack.co',
})

const validParams = {
  transferId: 'txn_002',
  amount: new Decimal('250000.50'),
  currency: 'NGN',
  bankCode: '058',
  accountNumber: '0123456789',
  recipientName: 'Jane Doe',
  reference: 'KL-PO-txn_002-1700000000000',
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('PaystackProvider', () => {
  it('has the correct name', () => {
    expect(provider.name).toBe('PAYSTACK')
  })

  describe('initiatePayout', () => {
    it('creates a transfer recipient then initiates transfer', async () => {
      // First call: create transfer recipient
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            recipient_code: 'RCP_abc123',
          },
        }),
      })
      // Second call: initiate transfer
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            transfer_code: 'TRF_xyz789',
            status: 'pending',
          },
        }),
      })

      const result = await provider.initiatePayout(validParams)

      expect(result.providerRef).toBe('TRF_xyz789')
      expect(result.status).toBe('pending')

      // Verify recipient creation call
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const [recipientUrl, recipientOpts] = mockFetch.mock.calls[0]
      expect(recipientUrl).toBe('https://api.paystack.co/transferrecipient')
      expect(recipientOpts.method).toBe('POST')
      expect(recipientOpts.headers['Authorization']).toBe('Bearer sk_test_abc123')

      const recipientBody = JSON.parse(recipientOpts.body)
      expect(recipientBody.type).toBe('nuban')
      expect(recipientBody.bank_code).toBe('058')
      expect(recipientBody.account_number).toBe('0123456789')
      expect(recipientBody.name).toBe('Jane Doe')

      // Verify transfer initiation call
      const [transferUrl, transferOpts] = mockFetch.mock.calls[1]
      expect(transferUrl).toBe('https://api.paystack.co/transfer')
      expect(transferOpts.method).toBe('POST')

      const transferBody = JSON.parse(transferOpts.body)
      expect(transferBody.source).toBe('balance')
      expect(transferBody.recipient).toBe('RCP_abc123')
      // Paystack uses kobo (amount * 100)
      expect(transferBody.amount).toBe(25000050)
      expect(transferBody.reference).toBe(validParams.reference)
      expect(transferBody.reason).toContain('Jane Doe')
    })

    it('throws PayoutError on recipient creation failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: false,
          message: 'Invalid account number',
        }),
      })

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(PayoutError)
      // Should only make one call (recipient) and fail before transfer
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('throws PayoutError on transfer initiation failure', async () => {
      // Recipient creation succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          data: { recipient_code: 'RCP_abc123' },
        }),
      })
      // Transfer fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          status: false,
          message: 'You cannot initiate third party payouts at this time',
        }),
      })

      await expect(provider.initiatePayout(validParams)).rejects.toThrow(PayoutError)
    })
  })

  describe('getPayoutStatus', () => {
    it('returns status for a successful transfer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            status: 'success',
          },
        }),
      })

      const result = await provider.getPayoutStatus('TRF_xyz789')

      expect(result.status).toBe('success')
      expect(result.failureReason).toBeUndefined()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.paystack.co/transfer/verify/TRF_xyz789',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('returns failure reason when transfer failed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            status: 'failed',
            reason: 'Account could not be credited',
          },
        }),
      })

      const result = await provider.getPayoutStatus('TRF_xyz789')

      expect(result.status).toBe('failed')
      expect(result.failureReason).toBe('Account could not be credited')
    })

    it('throws PayoutError on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          status: false,
          message: 'Server error',
        }),
      })

      await expect(provider.getPayoutStatus('TRF_xyz789')).rejects.toThrow(PayoutError)
    })
  })
})
