import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { checkAndAlertFloat } from '../float-alert'

// ─── Mock the FloatMonitor ──────────────────────────

const mockCheckFloatBalance = vi.fn()
const mockPauseTransfers = vi.fn()
const mockResumeTransfers = vi.fn()

vi.mock('@/lib/payments/payout/float-monitor', () => {
  return {
    FloatMonitor: class {
      checkFloatBalance = mockCheckFloatBalance
      pauseTransfersIfLowFloat = mockPauseTransfers
      resumeTransfersIfFloatRestored = mockResumeTransfers
    },
  }
})

vi.mock('@/lib/payments/payout/flutterwave', () => {
  return {
    FlutterwaveProvider: class {},
  }
})

// ─── Setup / Teardown ────────────────────────────────

beforeEach(() => {
  mockCheckFloatBalance.mockReset()
  mockPauseTransfers.mockReset()
  mockResumeTransfers.mockReset()
})

// ─── Tests ───────────────────────────────────────────

describe('checkAndAlertFloat', () => {
  it('returns sufficient=true and no paused transfers when float is healthy', async () => {
    mockCheckFloatBalance.mockResolvedValue({
      provider: 'FLUTTERWAVE',
      balance: new Decimal('1500000'),
      sufficient: true,
    })
    mockResumeTransfers.mockResolvedValue(0)

    const result = await checkAndAlertFloat()

    expect(result.sufficient).toBe(true)
    expect(result.balance.toString()).toBe('1500000')
    expect(result.pausedCount).toBe(0)
    // When sufficient, should try to resume (in case float was just restored)
    expect(mockResumeTransfers).toHaveBeenCalled()
    // Should NOT pause
    expect(mockPauseTransfers).not.toHaveBeenCalled()
  })

  it('pauses transfers when float is low', async () => {
    mockCheckFloatBalance.mockResolvedValue({
      provider: 'FLUTTERWAVE',
      balance: new Decimal('200000'),
      sufficient: false,
    })
    mockPauseTransfers.mockResolvedValue(3)

    const result = await checkAndAlertFloat()

    expect(result.sufficient).toBe(false)
    expect(result.pausedCount).toBe(3)
    expect(mockPauseTransfers).toHaveBeenCalled()
    // Should NOT try to resume when insufficient
    expect(mockResumeTransfers).not.toHaveBeenCalled()
  })

  it('resumes transfers when float is restored', async () => {
    mockCheckFloatBalance.mockResolvedValue({
      provider: 'FLUTTERWAVE',
      balance: new Decimal('800000'),
      sufficient: true,
    })
    mockResumeTransfers.mockResolvedValue(2)

    const result = await checkAndAlertFloat()

    expect(result.sufficient).toBe(true)
    expect(result.resumedCount).toBe(2)
    expect(mockResumeTransfers).toHaveBeenCalled()
  })

  it('returns threshold value from environment', async () => {
    mockCheckFloatBalance.mockResolvedValue({
      provider: 'FLUTTERWAVE',
      balance: new Decimal('500000'),
      sufficient: true,
    })
    mockResumeTransfers.mockResolvedValue(0)

    const result = await checkAndAlertFloat()

    expect(result.threshold).toBeDefined()
    expect(result.threshold.gt(0)).toBe(true)
  })
})
