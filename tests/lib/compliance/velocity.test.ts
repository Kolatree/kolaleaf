import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  prisma: {
    transfer: { count: vi.fn() },
    complianceReport: { create: vi.fn() },
  },
}))
vi.mock('@/lib/obs/logger', () => ({ log: vi.fn() }))

import {
  evaluateUserVelocity,
  recordVelocityCheck,
  VELOCITY_HARD_CAP_PER_HOUR,
} from '@/lib/compliance/velocity'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'

const mockCount = vi.mocked(prisma.transfer.count)
const mockCreate = vi.mocked(prisma.complianceReport.create)
const mockLog = vi.mocked(log)

describe('evaluateUserVelocity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not-flagged when trailing hour is under the hard cap and under the spike ratio', async () => {
    // 2 transfers in last hour, 100 in baseline 30d -> ~0.14/hr avg, 2 / 0.14 ≈ 14x
    // but requires MIN_SPIKE_COUNT (3), so 2 does not trigger spike either
    mockCount.mockResolvedValueOnce(2).mockResolvedValueOnce(100)
    const flag = await evaluateUserVelocity('u1')
    expect(flag.flagged).toBe(false)
  })

  it('flags hard_cap when trailing hour >= VELOCITY_HARD_CAP_PER_HOUR', async () => {
    mockCount
      .mockResolvedValueOnce(VELOCITY_HARD_CAP_PER_HOUR)
      .mockResolvedValueOnce(10_000)
    const flag = await evaluateUserVelocity('u1')
    expect(flag.flagged).toBe(true)
    if (flag.flagged) {
      expect(flag.reason).toBe('hard_cap')
      expect(flag.countInWindow).toBe(VELOCITY_HARD_CAP_PER_HOUR)
    }
  })

  it('flags spike_ratio when count >= 5x baseline and >= MIN_SPIKE_COUNT', async () => {
    // baseline: 10 transfers in ~720h = ~0.014/hr. 5 transfers in trailing hour.
    // 5 >= MIN_SPIKE_COUNT (3). 5 >= 0.014 * 5 = 0.07 → trivially yes.
    mockCount.mockResolvedValueOnce(5).mockResolvedValueOnce(10)
    const flag = await evaluateUserVelocity('u1')
    expect(flag.flagged).toBe(true)
    if (flag.flagged) expect(flag.reason).toBe('spike_ratio')
  })

  it('does not flag spike when trailing count is below MIN_SPIKE_COUNT', async () => {
    // 2 in window, 0 baseline -> ratio undefined (null), no flag
    mockCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0)
    const flag = await evaluateUserVelocity('u1')
    expect(flag.flagged).toBe(false)
  })

  it('does not flag when no baseline exists (first-month user)', async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0)
    const flag = await evaluateUserVelocity('u1')
    // 3 in window, no baseline, below hard cap -> no flag
    expect(flag.flagged).toBe(false)
  })
})

describe('recordVelocityCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue({} as never)
  })

  it('writes a SUSPICIOUS ComplianceReport on flag', async () => {
    mockCount
      .mockResolvedValueOnce(VELOCITY_HARD_CAP_PER_HOUR)
      .mockResolvedValueOnce(10_000)
    const flag = await recordVelocityCheck('u1', 't1')
    expect(flag.flagged).toBe(true)
    expect(mockCreate).toHaveBeenCalledOnce()
    const data = mockCreate.mock.calls[0][0].data
    expect(data.type).toBe('SUSPICIOUS')
    expect(data.userId).toBe('u1')
    expect(data.transferId).toBe('t1')
  })

  it('does nothing on no-flag', async () => {
    mockCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const flag = await recordVelocityCheck('u1')
    expect(flag.flagged).toBe(false)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('swallows ComplianceReport write errors so the caller continues', async () => {
    mockCount
      .mockResolvedValueOnce(VELOCITY_HARD_CAP_PER_HOUR)
      .mockResolvedValueOnce(10_000)
    mockCreate.mockRejectedValueOnce(new Error('DB offline'))
    // Must NOT throw — a broken compliance pipe can't break transfers.
    const flag = await recordVelocityCheck('u1')
    expect(flag.flagged).toBe(true)
    expect(mockLog).toHaveBeenCalledWith(
      'error',
      'compliance.velocity_report_failed',
      expect.objectContaining({ userId: 'u1' }),
    )
  })
})
