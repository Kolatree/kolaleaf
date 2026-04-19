import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { StubMonoovaClient } from '../stub-client'

describe('StubMonoovaClient', () => {
  const stub = new StubMonoovaClient()

  describe('createPayId', () => {
    it('returns a STUB- prefixed PayID reference derived from the caller reference', async () => {
      const result = await stub.createPayId({
        transferId: 'txn-xyz',
        amount: new Decimal('100.00'),
        reference: 'KL-txn-xyz-1700000000',
      })

      expect(result.payIdReference).toBe('STUB-KL-txn-xyz-1700000000')
      expect(result.payId).toBe('stub@payid.kolaleaf.dev')
    })

    it('is side-effect free (no network call) — returns synchronously-resolvable promise', async () => {
      // If `global.fetch` were called, this test would be one step away from
      // a real network hit. We assert the stub produces a plain result.
      const result = await stub.createPayId({
        transferId: 'x',
        amount: new Decimal('1'),
        reference: 'ref',
      })
      expect(result).toEqual({
        payId: 'stub@payid.kolaleaf.dev',
        payIdReference: 'STUB-ref',
      })
    })
  })

  describe('getPaymentStatus', () => {
    it('returns status=completed with receivedAt set', async () => {
      const result = await stub.getPaymentStatus('STUB-KL-abc')
      expect(result.status).toBe('completed')
      expect(result.amount).toBe(0)
      expect(result.receivedAt).toBeInstanceOf(Date)
    })
  })
})
