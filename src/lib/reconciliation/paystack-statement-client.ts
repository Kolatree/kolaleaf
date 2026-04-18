import Decimal from 'decimal.js'
import {
  withRetry,
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
} from '@/lib/http/retry'
import type { StatementClient, StatementEntry } from './types'

/**
 * Paystack NGN payout statement client (fallback provider).
 *
 * Paystack is the failover for Flutterwave; it carries a subset of the
 * payout volume and the reconciliation job must diff it independently.
 *
 * Endpoint (provisional — schema confirmed in staging; amounts below
 * are the only contract that matters to the diff engine):
 *   GET {PAYSTACK_API_URL}/transfer?from={iso}&to={iso}
 *   → { data: [{ reference, amount: kobo, currency,
 *                transferred_at, status }, ...] }
 * Only entries with status === 'success' are surfaced.
 *
 * Amount unit: Paystack returns amounts in **kobo** (1/100 NGN). All
 * entries are divided by 100 via decimal.js so rounding does not drift
 * across a reconciliation window (a cent lost per transfer compounds
 * into an AUSTRAC finding fast).
 *
 * Env contract:
 *   - PAYSTACK_API_URL     (new; example: https://api.paystack.co)
 *   - PAYSTACK_SECRET_KEY  (already used by webhook handler)
 * Both required in production. In dev/test, absence yields a no-op
 * mock client that returns [] so the job can run safely without
 * creds and every real ledger row is flagged as missing_in_statement —
 * loud, not silent. Same rationale as the Flutterwave mock.
 *
 * Lazy validation: env is checked on factory call, not at module
 * import, so `next build` can traverse importers without creds wired.
 */

export interface PaystackStatementConfig {
  apiUrl: string
  apiKey: string
  isMock: boolean
}

export function validatePaystackStatementConfig(): PaystackStatementConfig {
  const apiUrl = process.env.PAYSTACK_API_URL
  const apiKey = process.env.PAYSTACK_SECRET_KEY
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && (!apiUrl || !apiKey)) {
    throw new Error(
      'Paystack statement config missing in production: PAYSTACK_API_URL, PAYSTACK_SECRET_KEY',
    )
  }

  return {
    apiUrl: apiUrl ?? '',
    apiKey: apiKey ?? '',
    isMock: !apiUrl || !apiKey,
  }
}

interface PaystackTransferRaw {
  reference?: string
  amount?: number | string
  currency?: string
  transferred_at?: string
  status?: string
}

const KOBO_PER_NGN = new Decimal(100)

export class PaystackStatementClient implements StatementClient {
  public readonly provider = 'paystack' as const

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async fetchStatement(from: Date, to: Date): Promise<StatementEntry[]> {
    const qs = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    })
    const url = `${this.baseUrl}/transfer?${qs.toString()}`

    const payload = await withRetry<{ data?: PaystackTransferRaw[] }>(
      (signal) => this.request(url, signal),
    )

    const rows = Array.isArray(payload.data) ? payload.data : []
    const entries: StatementEntry[] = []

    for (const row of rows) {
      if (row.status !== 'success') continue
      if (!row.reference || row.amount == null || !row.transferred_at) continue

      // Kobo → NGN via decimal.js; integer/string inputs accepted so a
      // provider-side precision tweak doesn't crash the diff.
      const amountNgn = new Decimal(row.amount).dividedBy(KOBO_PER_NGN)

      entries.push({
        provider: 'paystack',
        providerRef: String(row.reference),
        amount: amountNgn,
        currency: String(row.currency ?? 'NGN'),
        occurredAt: new Date(row.transferred_at),
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
        `Paystack network error: ${String(err)}`,
      )
    }

    if (!response.ok) {
      throw errorForStatus(
        response.status,
        `Paystack API error: ${response.status}`,
      )
    }

    try {
      return (await response.json()) as T
    } catch (err) {
      throw new ProviderPermanentError(
        `Paystack response parse error: ${String(err)}`,
      )
    }
  }
}

/**
 * Mock client returned in dev/test when credentials are absent. Yields
 * an empty statement so the diff engine reports every ledger row as
 * `missing_in_statement`. Never synthesises data — a fake-match would
 * hide a real reconciliation gap.
 */
class PaystackStatementMockClient implements StatementClient {
  public readonly provider = 'paystack' as const
  async fetchStatement(): Promise<StatementEntry[]> {
    return []
  }
}

export function createPaystackStatementClient(): StatementClient {
  const { apiUrl, apiKey, isMock } = validatePaystackStatementConfig()
  if (isMock) return new PaystackStatementMockClient()
  return new PaystackStatementClient(apiUrl, apiKey)
}
