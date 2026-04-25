import Decimal from 'decimal.js'
import { withRetry } from '@/lib/http/retry'
import type { StatementClient, StatementEntry } from './types'
import { BaseStatementClient, validateProviderConfig } from './base-statement-client'

/**
 * BudPay NGN payout statement client (primary provider).
 *
 * BudPay is the primary NGN disburser; the reconciliation job pulls
 * BudPay's debit-side statement for this corridor.
 *
 * Endpoint (provisional — schema confirmed in staging; amounts below
 * are the only contract that matters to the diff engine):
 *   GET {BUDPAY_API_URL}/api/v2/list_transfers?from={iso}&to={iso}
 *   → { data: [{ reference, amount, currency, transferred_at,
 *                status }, ...] }
 * Only entries with status === 'success' are surfaced.
 *
 * Amount unit: BudPay returns NGN in major units (not kobo). Parsed
 * via decimal.js so a provider-side precision tweak (string vs number)
 * does not crash the diff.
 *
 * Env contract:
 *   - BUDPAY_API_URL     (example: https://api.budpay.com)
 *   - BUDPAY_SECRET_KEY  (already used by webhook handler)
 * Both required in production. In dev/test, absence yields a no-op
 * mock client that returns [] so the job can run safely without
 * creds and every real ledger row is flagged as missing_in_statement —
 * loud, not silent. Same rationale as the Flutterwave mock.
 *
 * Lazy validation: env is checked on factory call, not at module
 * import, so `next build` can traverse importers without creds wired.
 */

interface BudPayTransferRaw {
  reference?: string
  amount?: number | string
  currency?: string
  transferred_at?: string
  status?: string
}

export class BudPayStatementClient extends BaseStatementClient {
  public readonly provider = 'budpay' as const

  async fetchStatement(from: Date, to: Date): Promise<StatementEntry[]> {
    const qs = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    })
    const url = `${this.baseUrl}/api/v2/list_transfers?${qs.toString()}`

    const payload = await withRetry<{ data?: BudPayTransferRaw[] }>(
      (signal) => this.request(url, signal),
    )

    const rows = Array.isArray(payload.data) ? payload.data : []
    const entries: StatementEntry[] = []

    for (const row of rows) {
      if (row.status !== 'success') continue
      if (!row.reference || row.amount == null || !row.transferred_at) continue

      // NGN major units — no kobo conversion. String/number inputs
      // accepted so a provider-side precision tweak doesn't crash the
      // diff.
      const amountNgn = new Decimal(row.amount)

      entries.push({
        provider: 'budpay',
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
}

/**
 * Mock client returned in dev/test when credentials are absent. Yields
 * an empty statement so the diff engine reports every ledger row as
 * `missing_in_statement`. Never synthesises data — a fake-match would
 * hide a real reconciliation gap.
 */
class BudPayStatementMockClient implements StatementClient {
  public readonly provider = 'budpay' as const
  async fetchStatement(): Promise<StatementEntry[]> {
    return []
  }
}

export function createBudPayStatementClient(): StatementClient {
  const { apiUrl, apiKey, isMock } = validateProviderConfig({
    urlEnv: 'BUDPAY_API_URL',
    keyEnv: 'BUDPAY_SECRET_KEY',
    providerName: 'BudPay',
  })
  if (isMock) return new BudPayStatementMockClient()
  return new BudPayStatementClient(apiUrl, apiKey)
}
