/**
 * Shared retry + timeout helpers for outbound provider calls.
 *
 * Every third-party integration (Sumsub, Monoova, Flutterwave, Paystack,
 * FX rate API) routes its network calls through `withRetry` so a hung
 * provider cannot block the platform indefinitely and a transient blip
 * doesn't kill a transfer that would have succeeded on retry.
 *
 * Error taxonomy that callers should branch on:
 *   - `ProviderTimeoutError`   — request aborted by our AbortController
 *   - `ProviderTemporaryError` — network error / 5xx — safe to retry
 *   - `ProviderPermanentError` — 4xx / invalid input — do NOT retry
 *
 * Defaults (3 attempts, 500ms base, 8s cap, 15s timeout) are tuned for
 * payments/KYC providers. Callers can override per-call when a provider
 * needs different tolerances (e.g. FX API has a shorter SLA).
 */

export class ProviderTimeoutError extends Error {
  constructor(message: string = 'Provider request timed out') {
    super(message)
    this.name = 'ProviderTimeoutError'
  }
}

export class ProviderTemporaryError extends Error {
  public readonly statusCode?: number
  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'ProviderTemporaryError'
    this.statusCode = statusCode
  }
}

export class ProviderPermanentError extends Error {
  public readonly statusCode?: number
  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'ProviderPermanentError'
    this.statusCode = statusCode
  }
}

export interface RetryOptions {
  /** Total attempt count including the first call. Default 3. */
  attempts?: number
  /** Initial backoff delay in ms. Default 500. */
  baseDelayMs?: number
  /** Upper bound on backoff delay in ms. Default 8000. */
  maxDelayMs?: number
  /** Per-attempt timeout in ms (AbortController). Default 15000. */
  timeoutMs?: number
  /**
   * Predicate that decides whether a given error is worth retrying.
   * Default: retries `ProviderTimeoutError` + `ProviderTemporaryError`
   * and generic network errors; does NOT retry `ProviderPermanentError`.
   */
  shouldRetry?: (err: unknown) => boolean
  /** Hook for tests to control jitter. Default Math.random. */
  random?: () => number
  /** Hook for tests to control sleep. Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 8_000
const DEFAULT_TIMEOUT_MS = 15_000

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof ProviderPermanentError) return false
  if (err instanceof ProviderTimeoutError) return true
  if (err instanceof ProviderTemporaryError) return true
  // Native fetch network errors surface as TypeError('fetch failed') or
  // DOMException AbortError — treat both as transient.
  if (err instanceof TypeError) return true
  if (err instanceof DOMException && err.name === 'AbortError') return true
  return false
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `fn` with exponential backoff + jitter on retryable errors.
 *
 * `fn` receives an `AbortSignal` that is already wired to the per-attempt
 * timeout; providers that use `fetch` should forward it as `signal`.
 * If the signal fires, `withRetry` throws `ProviderTimeoutError` — the
 * provider does not need to translate `AbortError` itself.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry
  const random = opts.random ?? Math.random
  const sleep = opts.sleep ?? defaultSleep

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fn(controller.signal)
    } catch (err) {
      // Normalise any AbortError (from our timeout or bubbled up from fetch)
      // into a typed ProviderTimeoutError so callers can branch cleanly.
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new ProviderTimeoutError()
      } else {
        lastError = err
      }

      if (attempt === attempts || !shouldRetry(lastError)) {
        throw lastError
      }

      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      const jitter = exp * random()
      await sleep(jitter)
    } finally {
      clearTimeout(timer)
    }
  }

  // Unreachable — the loop either returns or throws on the final attempt.
  throw lastError
}

/**
 * Classify a fetch Response into a typed provider error.
 *
 * Caller is responsible for deciding whether the body is useful; this
 * helper only looks at the status code so it can be used by providers
 * with very different response shapes.
 */
export function errorForStatus(
  status: number,
  message: string,
): ProviderPermanentError | ProviderTemporaryError {
  if (status >= 500 || status === 429) {
    return new ProviderTemporaryError(message, status)
  }
  return new ProviderPermanentError(message, status)
}
