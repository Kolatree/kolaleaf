import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { MonoovaHttpClient } from '../client'
import type { MonoovaClient } from '../client'

describe('MonoovaHttpClient', () => {
  let client: MonoovaClient
  const baseUrl = 'https://api.monoova.com'
  const apiKey = 'test-api-key'

  beforeEach(() => {
    client = new MonoovaHttpClient(baseUrl, apiKey)
    vi.restoreAllMocks()
  })

  describe('createPayId', () => {
    it('creates a PayID and returns payId + payIdReference', async () => {
      const mockResponse = {
        payId: 'user@payid.monoova.com',
        payIdReference: 'KL-txn-123-1700000000',
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const result = await client.createPayId({
        transferId: 'txn-123',
        amount: new Decimal('250.00'),
        reference: 'KL-txn-123-1700000000',
      })

      expect(result.payId).toBe('user@payid.monoova.com')
      expect(result.payIdReference).toBe('KL-txn-123-1700000000')

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall[0]).toBe(`${baseUrl}/payid/create`)
      const opts = fetchCall[1] as RequestInit
      expect(opts.method).toBe('POST')
      expect(opts.headers).toEqual(
        expect.objectContaining({
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        })
      )
    })

    it('throws on non-200 API response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Bad Request' }), { status: 400 })
      )

      await expect(
        client.createPayId({
          transferId: 'txn-456',
          amount: new Decimal('100.00'),
          reference: 'KL-txn-456-1700000000',
        })
      ).rejects.toThrow('Monoova API error: 400')
    })

    it('throws on network timeout / fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network timeout'))

      await expect(
        client.createPayId({
          transferId: 'txn-789',
          amount: new Decimal('50.00'),
          reference: 'KL-txn-789-1700000000',
        })
      ).rejects.toThrow('network timeout')
    })

    it('throws on invalid response shape (missing payId)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 })
      )

      await expect(
        client.createPayId({
          transferId: 'txn-bad',
          amount: new Decimal('75.00'),
          reference: 'KL-txn-bad-1700000000',
        })
      ).rejects.toThrow('Invalid Monoova response: missing payId')
    })
  })

  describe('getPaymentStatus', () => {
    it('returns payment status for a valid reference', async () => {
      const mockResponse = {
        status: 'completed',
        amount: 250.0,
        receivedAt: '2025-01-15T10:30:00Z',
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const result = await client.getPaymentStatus('KL-txn-123-1700000000')

      expect(result.status).toBe('completed')
      expect(result.amount).toBe(250.0)
      expect(result.receivedAt).toEqual(new Date('2025-01-15T10:30:00Z'))
    })

    it('returns status without receivedAt when not yet paid', async () => {
      const mockResponse = {
        status: 'pending',
        amount: 0,
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const result = await client.getPaymentStatus('KL-txn-456-1700000000')

      expect(result.status).toBe('pending')
      expect(result.amount).toBe(0)
      expect(result.receivedAt).toBeUndefined()
    })

    it('throws on non-200 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })
      )

      await expect(
        client.getPaymentStatus('KL-unknown')
      ).rejects.toThrow('Monoova API error: 404')
    })
  })
})
