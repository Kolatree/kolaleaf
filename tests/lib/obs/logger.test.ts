import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logger, log } from '@/lib/obs/logger'
import { runWithRequestContext } from '@/lib/obs/request-context'

describe('log() emits structured lines', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('emits event + data through the pino instance', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    log('info', 'test.event', { widgetId: 'w1' })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toMatchObject({ event: 'test.event', widgetId: 'w1' })
  })

  it('injects requestId when inside runWithRequestContext', () => {
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    runWithRequestContext('req-abc', () => {
      log('warn', 'flow.start', { step: 3 })
    })
    expect(spy.mock.calls[0][0]).toMatchObject({
      event: 'flow.start',
      requestId: 'req-abc',
      step: 3,
    })
  })

  it('omits requestId when outside any request context', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    log('error', 'unattached.event')
    const payload = spy.mock.calls[0][0] as Record<string, unknown>
    expect(payload.event).toBe('unattached.event')
    expect(payload.requestId).toBeUndefined()
  })
})
