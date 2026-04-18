import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'

vi.mock('@/lib/db/client', () => ({
  prisma: { complianceReport: { create: vi.fn() } },
}))
vi.mock('@/lib/obs/logger', () => ({ log: vi.fn() }))

import {
  recordAustracReports,
  AUSTRAC_TTR_THRESHOLD_AUD,
} from '@/lib/compliance/austrac-reports'
import { prisma } from '@/lib/db/client'

const mockCreate = vi.mocked(prisma.complianceReport.create)

const baseCtx = {
  userId: 'u1',
  transferId: 't1',
  baseCurrency: 'AUD',
  targetCurrency: 'NGN',
}

describe('recordAustracReports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue({} as never)
  })

  it('records IFTI for every cross-border transfer, regardless of amount', async () => {
    const out = await recordAustracReports({
      ...baseCtx,
      sendAmountAud: new Decimal('50'),
    })
    expect(out.iftiRecorded).toBe(true)
    expect(out.ttrRecorded).toBe(false)
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockCreate.mock.calls[0][0].data.type).toBe('IFTI')
  })

  it('records BOTH TTR and IFTI when sendAmount >= buffered threshold (9,500)', async () => {
    const out = await recordAustracReports({
      ...baseCtx,
      sendAmountAud: new Decimal('9500'),
    })
    expect(out.ttrRecorded).toBe(true)
    expect(out.iftiRecorded).toBe(true)
    expect(mockCreate).toHaveBeenCalledTimes(2)
    const types = mockCreate.mock.calls.map((c) => c[0].data.type).sort()
    expect(types).toEqual(['IFTI', 'THRESHOLD'])
  })

  it('does NOT record TTR when sendAmount is just below buffered threshold', async () => {
    const out = await recordAustracReports({
      ...baseCtx,
      sendAmountAud: new Decimal('9499.99'),
    })
    expect(out.ttrRecorded).toBe(false)
    expect(out.iftiRecorded).toBe(true)
  })

  it('exports the threshold as 9,500 (buffered per Q1)', () => {
    expect(AUSTRAC_TTR_THRESHOLD_AUD.toString()).toBe('9500')
  })

  it('swallows errors on each report independently — failure on TTR does not block IFTI', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('DB offline for TTR'))
      .mockResolvedValueOnce({} as never)
    const out = await recordAustracReports({
      ...baseCtx,
      sendAmountAud: new Decimal('10000'),
    })
    expect(out.ttrRecorded).toBe(false)
    expect(out.iftiRecorded).toBe(true)
  })

  it('swallows IFTI write failure without throwing', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB offline for IFTI'))
    const out = await recordAustracReports({
      ...baseCtx,
      sendAmountAud: new Decimal('50'),
    })
    expect(out.iftiRecorded).toBe(false)
  })
})
