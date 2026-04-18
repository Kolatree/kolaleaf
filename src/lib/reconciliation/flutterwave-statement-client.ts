import Decimal from 'decimal.js'
import {
  withRetry,
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
} from '@/lib/http/retry'
import type { StatementClient, StatementEntry } from './types'

/**
 * Flutterwave NGN payout statement client.
 *
 * Used by the reconciliation job (daily diff between internal ledger and
 * provider statements, AUSTRAC requirement) to pull successful NGN
 * transfers that Flutterwave paid on our behalf in a given window.
 *
 * Endpoint (provisional — the exact shape is confirmed in staging and
 * the normaliser below is the only thing that cares about the response):
 *   GET {FLUTTERWAVE_API_URL}/transfers?from={iso}&to={iso}
 *   → { data: [{ reference, amount, currency, created_at, status }, ...] }
 * Only entries with status === 'SUCCESSFUL' are surfaced; everything
 * else (PENDING / FAILED / NEW) is silently dropped because the diff
 * engine only cares about settled debits.
 *
 * Env contract:
 *   - FLUTTERWAVE_API_URL    (already used by payout provider)
 *   - FLUTTERWAVE_SECRET_KEY (already used by payout provider)
 * Both are required in production. In dev/test, absence is tolerated
 * and the factory returns a no-op client that yields [] so a scheduled
 * reconciliation job doesn't crash a local environment that has no
 * Flutterwave creds wired up. This is safer than silent mock data
 * because an empty statement + populated ledger immediately surfaces as
 * "missing_in_statement" discrepancies the first time the job runs
 * against live creds — the gap is loud, not hidden.
 *
 * Lazy validation: the env check runs on factory call, not at module
 * import, so `next build` can evaluate routes that transitively import
 * this module before Railway env vars are wired.
 */

export interface FlutterwaveStatementConfig {
  apiUrl: string
  apiKey: string
  isMock: boolean
}

export function validateFlutterwaveStatementConfig(): FlutterwaveStatementConfig {
  const apiUrl = process.env.FLUTTERWAVE_API_URL
  const apiKey = process.env.FLUTTERWAVE_SECRET_KEY
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && (!apiUrl || !apiKey)) {
    throw new Error(
      'Flutterwave statement config missing in production: FLUTTERWAVE_API_URL, FLUTTERWAVE_SECRET_KEY',
    )
  }

  return {
    apiUrl: apiUrl ?? '',
    apiKey: apiKey ?? '',
    isMock: !apiUrl || !apiKey,
  }
}

interface FlutterwaveTransferRaw {
  reference?: string
  amount?: number | string
  currency?: string
  created_at?: string
  status?: string
}

export class FlutterwaveStatementClient implements StatementClient {
  public readonly provider = 'flutterwave' as const

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async fetchStatement(from: Date, to: Date): Promise<StatementEntry[]> {
    const qs = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    })
    const url = `${this.baseUrl}/transfers?${qs.toString()}`

    const payload = await withRetry<{ data?: FlutterwaveTransferRaw[] }>(
      (signal) => this.request(url, signal),
    )

    const rows = Array.isArray(payload.data) ? payload.data : []
    const entries: StatementEntry[] = []

    for (const row of rows) {
      if (row.status !== 'SUCCESSFUL') continue
      if (!row.reference || row.amount == null || !row.created_at) continue

      entries.push({
        provider: 'flutterwave',
        providerRef: String(row.reference),
        amount: new Decimal(row.amount),
        currency: String(row.currency ?? 'NGN'),
        occurredAt: new Date(row.created_at),
        direction: 'debit',
        raw: row as unknown as Record<string, unknown>,
      })
    }

    return entries
  }

  private async request<T>(url: string, signal: AbortSignal): Promise<T> {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new ProviderTemporaryError(
        `Flutterwave network error: ${String(err)}`,
      )
    }

    if (!response.ok) {
      throw errorForStatus(
        response.status,
        `Flutterwave API error: ${response.status}`,
      )
    }

    try {
      return (await response.json()) as T
    } catch (err) {
      throw new ProviderPermanentError(
        `Flutterwave response parse error: ${String(err)}`,
      )
    }
  }
}

/**
 * Mock client returned in dev/test when credentials are absent. Yields
 * an empty statement so the diff engine reports every ledger row as
 * `missing_in_statement` — loud, not silent. Never return synthetic
 * data here: a fake debit that "matches" a real ledger row would mask a
 * reconciliation gap the AUSTRAC audit cares about.
 */
class FlutterwaveStatementMockClient implements StatementClient {
  public readonly provider = 'flutterwave' as const
  async fetchStatement(): Promise<StatementEntry[]> {
    return []
  }
}

export function createFlutterwaveStatementClient(): StatementClient {
  const { apiUrl, apiKey, isMock } = validateFlutterwaveStatementConfig()
  if (isMock) return new FlutterwaveStatementMockClient()
  return new FlutterwaveStatementClient(apiUrl, apiKey)
}
