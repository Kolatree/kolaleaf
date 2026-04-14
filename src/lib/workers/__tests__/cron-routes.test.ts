import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock all workers ────────────────────────────────

vi.mock('../reconciliation', () => ({
  runDailyReconciliation: vi.fn().mockResolvedValue({
    expired: 0, flagged: 0, retried: 0,
    expiredIds: [], flaggedIds: [], retriedIds: [],
  }),
}))

vi.mock('../rate-refresh', () => ({
  refreshAllCorridorRates: vi.fn().mockResolvedValue([]),
}))

vi.mock('../staleness-alert', () => ({
  checkAndAlertStaleness: vi.fn().mockResolvedValue({
    alerts: [], blocked: [],
  }),
}))

vi.mock('../float-alert', () => ({
  checkAndAlertFloat: vi.fn().mockResolvedValue({
    balance: '1000000', threshold: '500000', sufficient: true, pausedCount: 0,
  }),
}))

// Import the mocked workers for assertion
import { runDailyReconciliation } from '../reconciliation'
import { refreshAllCorridorRates } from '../rate-refresh'
import { checkAndAlertStaleness } from '../staleness-alert'
import { checkAndAlertFloat } from '../float-alert'

// ─── Route imports ───────────────────────────────────
// We import the POST handlers directly from the route files

import { POST as reconciliationPOST } from '@/app/api/cron/reconciliation/route'
import { POST as ratesPOST } from '@/app/api/cron/rates/route'
import { POST as stalenessPOST } from '@/app/api/cron/staleness/route'
import { POST as floatPOST } from '@/app/api/cron/float/route'

// ─── Helpers ─────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret-123'

function makeCronRequest(secret?: string): Request {
  const headers: Record<string, string> = {}
  if (secret) {
    headers['authorization'] = `Bearer ${secret}`
  }
  return new Request('http://localhost:3000/api/cron/test', {
    method: 'POST',
    headers,
  })
}

// ─── Setup ───────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  vi.clearAllMocks()
})

// ─── Tests ───────────────────────────────────────────

describe('Cron API routes', () => {
  describe('POST /api/cron/reconciliation', () => {
    it('returns 401 without valid CRON_SECRET', async () => {
      const response = await reconciliationPOST(makeCronRequest('wrong-secret'))
      expect(response.status).toBe(401)
    })

    it('returns 401 without authorization header', async () => {
      const response = await reconciliationPOST(makeCronRequest())
      expect(response.status).toBe(401)
    })

    it('calls runDailyReconciliation with valid secret', async () => {
      const response = await reconciliationPOST(makeCronRequest(CRON_SECRET))
      expect(response.status).toBe(200)
      expect(runDailyReconciliation).toHaveBeenCalledOnce()
    })
  })

  describe('POST /api/cron/rates', () => {
    it('returns 401 without valid CRON_SECRET', async () => {
      const response = await ratesPOST(makeCronRequest('wrong-secret'))
      expect(response.status).toBe(401)
    })

    it('calls refreshAllCorridorRates with valid secret', async () => {
      const response = await ratesPOST(makeCronRequest(CRON_SECRET))
      expect(response.status).toBe(200)
      expect(refreshAllCorridorRates).toHaveBeenCalledOnce()
    })
  })

  describe('POST /api/cron/staleness', () => {
    it('returns 401 without valid CRON_SECRET', async () => {
      const response = await stalenessPOST(makeCronRequest('wrong-secret'))
      expect(response.status).toBe(401)
    })

    it('calls checkAndAlertStaleness with valid secret', async () => {
      const response = await stalenessPOST(makeCronRequest(CRON_SECRET))
      expect(response.status).toBe(200)
      expect(checkAndAlertStaleness).toHaveBeenCalledOnce()
    })
  })

  describe('POST /api/cron/float', () => {
    it('returns 401 without valid CRON_SECRET', async () => {
      const response = await floatPOST(makeCronRequest('wrong-secret'))
      expect(response.status).toBe(401)
    })

    it('calls checkAndAlertFloat with valid secret', async () => {
      const response = await floatPOST(makeCronRequest(CRON_SECRET))
      expect(response.status).toBe(200)
      expect(checkAndAlertFloat).toHaveBeenCalledOnce()
    })
  })
})
