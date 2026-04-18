import Decimal from 'decimal.js'
import {
  withRetry,
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
} from '../http/retry'
import type { StatementClient, StatementEntry } from './types'

/**
 * Monoova statement (reconciliation) client.
 *
 * Fetches the daily/ad-hoc AUD PayID credit statement from Monoova so the
 * reconciliation diff engine can compare provider-side records against our
 * internal ledger.
 *
 * Endpoint contract (documented here because the real Monoova schema is
 * still being finalised with the integrations team — this is the single
 * adapter point; if production returns a different shape, fix it here
 * rather than in the diff engine):
 *
 *   GET {MONOOVA_STATEMENT_API_URL}/statements?from={iso}&to={iso}
 *   Authorization: Bearer {MONOOVA_API_KEY}
 *
 *   → 200 { entries: [
 *       { reference: "payid-123", amount: 100.00,
 *         occurredAt: "2026-04-18T00:00:00Z", type: "CREDIT" }, ...
 *     ] }
 *
 * Config: `MONOOVA_STATEMENT_API_URL` and `MONOOVA_API_KEY` are required in
 * production; missing either throws at `validateMonoovaStatementConfig()`
 * time. Dev/test without creds returns an empty `StatementEntry[]` rather
 * than silently fabricating data — a reconciliation gap must surface to
 * operators, not be masked by fake fixtures.
 *
 * Validation is LAZY (first-use, not module-load) so `next build` can
 * evaluate modules that transitively import this file before env is wired.
 *
 * All entries emitted here are AUD credits (customers pushing AUD via
 * PayID). The diff engine uses `direction === 'credit'` to match against
 * `Transfer.payidProviderRef`.
 */

export interface MonoovaStatementConfig {
  apiUrl: string
  apiKey: string
  isMock: boolean
}

export function validateMonoovaStatementConfig(): MonoovaStatementConfig {
  const apiUrl = process.env.MONOOVA_STATEMENT_API_URL
  const apiKey = process.env.MONOOVA_API_KEY
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction) {
    const missing: string[] = []
    if (!apiUrl) missing.push('MONOOVA_STATEMENT_API_URL')
    if (!apiKey) missing.push('MONOOVA_API_KEY')
    if (missing.length > 0) {
      throw new Error(
        `Monoova statement config missing in production: ${missing.join(', ')}`,
      )
    }
  }

  return {
    apiUrl: apiUrl ?? '',
    apiKey: apiKey ?? '',
    isMock: !apiUrl || !apiKey,
  }
}

// Raw entry shape as it appears on the wire. Kept narrow on purpose —
// anything outside this contract is preserved verbatim on `raw` so
// compliance can inspect the source record when investigating diffs.
interface RawMonoovaStatementEntry {
  reference?: unknown
  amount?: unknown
  occurredAt?: unknown
  type?: unknown
  [key: string]: unknown
}

interface RawMonoovaStatementResponse {
  entries?: RawMonoovaStatementEntry[]
}

function normaliseEntry(raw: RawMonoovaStatementEntry): StatementEntry {
  const providerRef =
    typeof raw.reference === 'string' ? raw.reference : String(raw.reference ?? '')
  const amount = new Decimal(
    typeof raw.amount === 'number' || typeof raw.amount === 'string'
      ? raw.amount
      : 0,
  )
  const occurredAtStr =
    typeof raw.occurredAt === 'string' ? raw.occurredAt : ''
  const occurredAt = new Date(occurredAtStr)

  return {
    provider: 'monoova',
    providerRef,
    amount,
    currency: 'AUD',
    occurredAt,
    direction: 'credit',
    raw: raw as Record<string, unknown>,
  }
}

export class MonoovaStatementClient implements StatementClient {
  public readonly provider = 'monoova' as const

  constructor(
    private readonly config: { apiUrl: string; apiKey: string },
  ) {}

  /**
   * Factory that reads env vars and returns either a live client or a
   * stub (`isMock`) that emits `[]`. Prefer this at call-sites so the
   * production guard runs; construct `new MonoovaStatementClient({...})`
   * directly only in tests with explicit creds.
   */
  static fromEnv(): MonoovaStatementClient {
    const cfg = validateMonoovaStatementConfig()
    return new MonoovaStatementClient({
      apiUrl: cfg.apiUrl,
      apiKey: cfg.apiKey,
    })
  }

  async fetchStatement(from: Date, to: Date): Promise<StatementEntry[]> {
    // Dev/test without creds: return empty rather than hit the network.
    // In production validateMonoovaStatementConfig() would have thrown
    // before we ever constructed with empty strings (via fromEnv).
    if (!this.config.apiUrl || !this.config.apiKey) {
      return []
    }

    const url =
      `${this.config.apiUrl}/statements` +
      `?from=${encodeURIComponent(from.toISOString())}` +
      `&to=${encodeURIComponent(to.toISOString())}`

    const data = await withRetry<RawMonoovaStatementResponse>((signal) =>
      this.request(url, signal),
    )

    const rawEntries = Array.isArray(data.entries) ? data.entries : []
    return rawEntries.map(normaliseEntry)
  }

  private async request(
    url: string,
    signal: AbortSignal,
  ): Promise<RawMonoovaStatementResponse> {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new ProviderTemporaryError(
        `Monoova statement network error: ${String(err)}`,
      )
    }

    if (!response.ok) {
      throw errorForStatus(
        response.status,
        `Monoova statement API error: ${response.status}`,
      )
    }

    try {
      return (await response.json()) as RawMonoovaStatementResponse
    } catch (err) {
      throw new ProviderPermanentError(
        `Monoova statement response parse error: ${String(err)}`,
      )
    }
  }
}
