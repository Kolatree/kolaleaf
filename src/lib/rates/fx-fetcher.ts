import Decimal from 'decimal.js'

// ─── Interface ──────────────────────────────────────

export interface FxRateProvider {
  name: string
  fetchWholesaleRate(baseCurrency: string, targetCurrency: string): Promise<Decimal>
}

// ─── Default implementation ─────────────────────────

interface FxApiConfig {
  apiKey: string
  apiUrl: string
  timeoutMs?: number
}

export class DefaultFxRateProvider implements FxRateProvider {
  readonly name = 'default-fx'
  private readonly config: FxApiConfig

  constructor(config?: FxApiConfig) {
    this.config = config ?? {
      apiKey: process.env.FX_API_KEY ?? '',
      apiUrl: process.env.FX_API_URL ?? '',
    }
  }

  async fetchWholesaleRate(baseCurrency: string, targetCurrency: string): Promise<Decimal> {
    const url = `${this.config.apiUrl}/latest?base=${baseCurrency}&symbols=${targetCurrency}&apikey=${this.config.apiKey}`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('FX API request timed out')
      }
      throw err
    }

    if (!response.ok) {
      throw new Error(`FX API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const rate = data?.rates?.[targetCurrency]

    if (rate == null) {
      throw new Error(`No rate returned for ${targetCurrency}`)
    }

    return new Decimal(rate)
  }
}
