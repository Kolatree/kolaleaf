import { describe, it, expect, vi } from 'vitest'
import {
  withRetry,
  ProviderTimeoutError,
  ProviderTemporaryError,
  ProviderPermanentError,
  errorForStatus,
} from '@/lib/http/retry'

/**
 * We inject a synchronous `sleep` and a deterministic `random` so the
 * retry loop runs instantly without touching real timers.
 */
const noSleep = () => Promise.resolve()
const zeroJitter = () => 0

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { sleep: noSleep, random: zeroJitter })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('retries a transient error and returns on the second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderTemporaryError('flaky', 503))
      .mockResolvedValueOnce('ok')

    const result = await withRetry(fn, { sleep: noSleep, random: zeroJitter })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after the configured attempt count on transient errors', async () => {
    const err = new ProviderTemporaryError('still flaky', 502)
    const fn = vi.fn().mockRejectedValue(err)

    await expect(
      withRetry(fn, { attempts: 3, sleep: noSleep, random: zeroJitter }),
    ).rejects.toBe(err)

    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry permanent errors', async () => {
    const err = new ProviderPermanentError('bad input', 400)
    const fn = vi.fn().mockRejectedValue(err)

    await expect(
      withRetry(fn, { sleep: noSleep, random: zeroJitter }),
    ).rejects.toBe(err)

    expect(fn).toHaveBeenCalledOnce()
  })

  it('honours a custom shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('custom'))

    await expect(
      withRetry(fn, {
        attempts: 3,
        shouldRetry: () => false,
        sleep: noSleep,
        random: zeroJitter,
      }),
    ).rejects.toThrow('custom')

    expect(fn).toHaveBeenCalledOnce()
  })

  it('translates AbortError raised via the timeout signal into ProviderTimeoutError', async () => {
    const fn = vi.fn().mockImplementation((signal: AbortSignal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    })

    await expect(
      withRetry(fn, {
        attempts: 1,
        timeoutMs: 10,
        sleep: noSleep,
        random: zeroJitter,
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError)

    expect(fn).toHaveBeenCalledOnce()
  })

  it('retries on ProviderTimeoutError by default', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderTimeoutError())
      .mockResolvedValueOnce('ok')

    const result = await withRetry(fn, { sleep: noSleep, random: zeroJitter })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('treats native TypeError (fetch network failure) as retryable', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('ok')

    const result = await withRetry(fn, { sleep: noSleep, random: zeroJitter })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('invokes the jitter random() once per retry sleep', async () => {
    // Proves jitter is actually applied in the backoff delay, not just
    // that the injection point exists. Spied random returns 0 so the
    // test still runs in zero wall-clock time via noSleep.
    const random = vi.fn(() => 0)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderTemporaryError('retry me', 502))
      .mockRejectedValueOnce(new ProviderTemporaryError('retry me', 502))
      .mockResolvedValueOnce('ok')

    await withRetry(fn, { attempts: 3, sleep: noSleep, random })
    // Two failures -> two backoff sleeps -> two jitter samples.
    expect(random).toHaveBeenCalledTimes(2)
  })

  it('forwards a live AbortSignal to fn on each attempt', async () => {
    const signals: AbortSignal[] = []
    const fn = vi
      .fn()
      .mockImplementationOnce(async (signal: AbortSignal) => {
        signals.push(signal)
        throw new ProviderTemporaryError('retry me', 502)
      })
      .mockImplementationOnce(async (signal: AbortSignal) => {
        signals.push(signal)
        return 'ok'
      })

    await withRetry(fn, { sleep: noSleep, random: zeroJitter })

    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })
})

describe('errorForStatus', () => {
  it('returns a permanent error for 4xx', () => {
    const err = errorForStatus(400, 'bad request')
    expect(err).toBeInstanceOf(ProviderPermanentError)
    expect(err.statusCode).toBe(400)
  })

  it('returns a temporary error for 5xx', () => {
    const err = errorForStatus(503, 'service unavailable')
    expect(err).toBeInstanceOf(ProviderTemporaryError)
    expect(err.statusCode).toBe(503)
  })

  it('returns a temporary error for 429 (rate limit is transient)', () => {
    const err = errorForStatus(429, 'rate limited')
    expect(err).toBeInstanceOf(ProviderTemporaryError)
    expect(err.statusCode).toBe(429)
  })
})
