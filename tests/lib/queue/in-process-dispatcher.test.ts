import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/payments/monoova/webhook', () => ({
  handleMonoovaWebhook: vi.fn(),
}))
vi.mock('@/lib/payments/payout/webhooks', () => ({
  handleFlutterwaveWebhook: vi.fn(),
  handleBudPayWebhook: vi.fn(),
}))
vi.mock('@/lib/kyc/sumsub/webhook', () => ({
  handleSumsubWebhook: vi.fn(),
}))

import { InProcessDispatcher } from '@/lib/queue/in-process-dispatcher'
import { handleMonoovaWebhook } from '@/lib/payments/monoova/webhook'
import {
  handleFlutterwaveWebhook,
  handleBudPayWebhook,
} from '@/lib/payments/payout/webhooks'
import { handleSumsubWebhook } from '@/lib/kyc/sumsub/webhook'

const monoovaMock = vi.mocked(handleMonoovaWebhook)
const flutterwaveMock = vi.mocked(handleFlutterwaveWebhook)
const budpayMock = vi.mocked(handleBudPayWebhook)
const sumsubMock = vi.mocked(handleSumsubWebhook)

describe('InProcessDispatcher', () => {
  const dispatcher = new InProcessDispatcher()
  const receivedAt = new Date().toISOString()

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FLUTTERWAVE_WEBHOOK_SECRET = 'fw-secret'
    process.env.BUDPAY_WEBHOOK_SECRET = 'bp-secret'
  })

  it('dispatches monoova jobs to the monoova handler', async () => {
    monoovaMock.mockResolvedValue(undefined)
    await dispatcher.dispatch({
      provider: 'monoova',
      rawBody: '{"eventId":"m1"}',
      signature: 'sig',
      receivedAt,
    })
    expect(monoovaMock).toHaveBeenCalledWith('{"eventId":"m1"}', 'sig')
    expect(flutterwaveMock).not.toHaveBeenCalled()
  })

  it('dispatches flutterwave jobs with the env secret', async () => {
    flutterwaveMock.mockResolvedValue(undefined)
    await dispatcher.dispatch({
      provider: 'flutterwave',
      rawBody: '{"event":"x"}',
      signature: 'fw-sig',
      receivedAt,
    })
    expect(flutterwaveMock).toHaveBeenCalledWith(
      '{"event":"x"}',
      'fw-sig',
      'fw-secret',
    )
  })

  it('dispatches BudPay jobs with the env secret', async () => {
    budpayMock.mockResolvedValue(undefined)
    await dispatcher.dispatch({
      provider: 'budpay',
      rawBody: '{"event":"x"}',
      signature: 'bp-sig',
      receivedAt,
    })
    expect(budpayMock).toHaveBeenCalledWith(
      '{"event":"x"}',
      'bp-sig',
      'bp-secret',
    )
  })

  it('dispatches sumsub jobs to the sumsub handler', async () => {
    sumsubMock.mockResolvedValue(undefined)
    await dispatcher.dispatch({
      provider: 'sumsub',
      rawBody: '{"applicantId":"a1"}',
      signature: 'ks-sig',
      receivedAt,
    })
    expect(sumsubMock).toHaveBeenCalledWith('{"applicantId":"a1"}', 'ks-sig')
  })

  it('bubbles handler errors so the caller (route/provider) can retry', async () => {
    monoovaMock.mockRejectedValue(new Error('db down'))
    await expect(
      dispatcher.dispatch({
        provider: 'monoova',
        rawBody: '{}',
        signature: 's',
        receivedAt,
      }),
    ).rejects.toThrow('db down')
  })

  it('throws when flutterwave secret is missing', async () => {
    delete process.env.FLUTTERWAVE_WEBHOOK_SECRET
    await expect(
      dispatcher.dispatch({
        provider: 'flutterwave',
        rawBody: '{}',
        signature: 's',
        receivedAt,
      }),
    ).rejects.toThrow('FLUTTERWAVE_WEBHOOK_SECRET not configured')
    expect(flutterwaveMock).not.toHaveBeenCalled()
  })

  it('throws when BudPay secret is missing', async () => {
    delete process.env.BUDPAY_WEBHOOK_SECRET
    await expect(
      dispatcher.dispatch({
        provider: 'budpay',
        rawBody: '{}',
        signature: 's',
        receivedAt,
      }),
    ).rejects.toThrow('BUDPAY_WEBHOOK_SECRET not configured')
    expect(budpayMock).not.toHaveBeenCalled()
  })
})
