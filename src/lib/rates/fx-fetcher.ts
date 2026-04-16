import Decimal from 'decimal.js'
import {
  withRetry,
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
  ProviderTimeoutError,
} from '../http/retry'

// ─── Interface ──────────────────────────────────────

export interface FxRateProvider {
  name: string
  fetchWholesaleRate(baseCurrency: string, targetCurrency: string): Promise<Decimal>
}

// ─── Config + validation ────────────────────────────

interface FxApiConfig {
  apiKey: string
  apiUrl: string
  timeoutMs?: number
  isMock?: boolean
}

/**
 * FX rate API config.
 *
 * Production: `FX_API_KEY` and `FX_API_URL` are required; missing either
 * is a runtime failure the first time the rate is fetched. The check is
 * LAZY (first-use, not module-load) so `next build` can evaluate route
 * modules without throwing before env vars are wired on the host.
 *
 * Dev/test: config may be absent. Call-sites that construct
 * `DefaultFxRateProvider` directly with explicit creds (existing tests)
 * skip the env check entirely.
 *
 * Idempotency: GET-only, naturally idempotent — no key needed.
 */
export function validateFxConfig(): FxApiConfig {
  const apiKey = process.env.FX_API_KEY
  const apiUrl = process.env.FX_API_URL
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && (!apiKey || !apiUrl)) {
    throw new Error(
      'FX rate provider config missing in production: FX_API_KEY, FX_API_URL',
    )
  }

  return {
    apiKey: apiKey ?? '',
    apiUrl: apiUrl ?? '',
    isMock: !apiKey || !apiUrl,
  }
}

// ─── Default implementation ─────────────────────────

export class DefaultFxRateProvider implements FxRateProvider {
  readonly name = 'default-fx'
  private readonly explicitConfig: FxApiConfig | undefined
  private resolvedConfig: FxApiConfig | undefined

  constructor(config?: FxApiConfig) {
    // Constructor does NOT validate — keeps import + route-module evaluation
    // side-effect-free. Validation happens on first fetchWholesaleRate call.
    this.explicitConfig = config
  }

  private getConfig(): FxApiConfig {
    if (this.resolvedConfig) return this.resolvedConfig
    this.resolvedConfig = this.explicitConfig ?? validateFxConfig()
    return this.resolvedConfig
  }

  async fetchWholesaleRate(baseCurrency: string, targetCurrency: string): Promise<Decimal> {
    const config = this.getConfig()
    const url = `${config.apiUrl}/latest?base=${baseCurrency}&symbols=${targetCurrency}&apikey=${config.apiKey}`

    const data = await withRetry<{ rates?: Record<string, number> }>(
      async (signal) => {
        let response: Response
        try {
          response = await fetch(url, { method: 'GET', signal })
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err
          throw new ProviderTemporaryError(`FX network error: ${String(err)}`)
        }

        if (!response.ok) {
          throw errorForStatus(
            response.status,
            `FX API error: ${response.status} ${response.statusText}`,
          )
        }

        try {
          return (await response.json()) as { rates?: Record<string, number> }
        } catch (err) {
          throw new ProviderPermanentError(
            `FX response parse error: ${String(err)}`,
          )
        }
      },
      { timeoutMs: config.timeoutMs ?? 10_000 },
    )

    const rate = data?.rates?.[targetCurrency]
    if (rate == null) {
      throw new Error(`No rate returned for ${targetCurrency}`)
    }

    return new Decimal(rate)
  }
}

// Re-export the timeout error for callers that want to distinguish
// timeout from other failures when consuming the FX provider.
export { ProviderTimeoutError as FxTimeoutError }
