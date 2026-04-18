import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/queue/email-dispatcher', () => ({
  enqueueEmail: vi.fn(),
}))
vi.mock('@/lib/obs/logger', () => ({
  log: vi.fn(),
}))

import { alertOps } from '@/lib/obs/alert'
import { enqueueEmail } from '@/lib/queue/email-dispatcher'
import { log } from '@/lib/obs/logger'

const mockEnqueue = vi.mocked(enqueueEmail)
const mockLog = vi.mocked(log)

describe('alertOps', () => {
  const originalEnv = process.env.OPS_ALERT_EMAIL

  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPS_ALERT_EMAIL
    } else {
      process.env.OPS_ALERT_EMAIL = originalEnv
    }
  })

  it('always logs a warn line with event + data', async () => {
    delete process.env.OPS_ALERT_EMAIL
    await alertOps('alert.test', { x: 1 })
    expect(mockLog).toHaveBeenCalledWith('warn', 'alert.test', { x: 1 })
  })

  it('does NOT enqueue when OPS_ALERT_EMAIL is unset', async () => {
    delete process.env.OPS_ALERT_EMAIL
    await alertOps('alert.test', { x: 1 })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('enqueues an ops_alert email when OPS_ALERT_EMAIL is set', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com'
    mockEnqueue.mockResolvedValue()
    await alertOps('alert.float.low', { balance: '100' })
    expect(mockEnqueue).toHaveBeenCalledOnce()
    const job = mockEnqueue.mock.calls[0][0]
    expect(job).toMatchObject({
      template: 'ops_alert',
      toEmail: 'ops@example.com',
      event: 'alert.float.low',
      data: { balance: '100' },
    })
  })

  it('swallows enqueue errors without throwing', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com'
    mockEnqueue.mockRejectedValue(new Error('redis down'))
    await expect(alertOps('alert.test', {})).resolves.toBeUndefined()
    // Original warn + secondary error log = 2 calls
    expect(mockLog).toHaveBeenCalledTimes(2)
    expect(mockLog).toHaveBeenLastCalledWith(
      'error',
      'alert.delivery.enqueue_failed',
      expect.objectContaining({ originalEvent: 'alert.test' }),
    )
  })
})
