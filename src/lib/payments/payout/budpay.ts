import type {
  PayoutProvider,
  PayoutParams,
  PayoutResult,
  PayoutStatusResult,
} from './types'
import { PayoutError } from './types'
import {
  withRetry,
  ProviderPermanentError,
  ProviderTemporaryError,
  ProviderTimeoutError as HttpTimeoutError,
} from '../../http/retry'
import { isStubProvidersEnabled, assertStubProvidersSafe } from '../flag'

/**
 * BudPay payout client (primary provider for NGN payouts).
 *
 * CBN-licensed primary disburser; Flutterwave is the failover. BudPay's
 * public API at https://devs.budpay.com exposes /api/v2/bank_transfer
 * for single payouts with Bearer-token auth.
 *
 * Production: `BUDPAY_SECRET_KEY` and `BUDPAY_API_URL` are required;
 * missing the secret in production is a startup failure via
 * `validateBudPayConfig()`.
 *
 * Idempotency: BudPay's transfer endpoint accepts our per-payout
 * `reference` field and, defensively, an `Idempotency-Key` header. We
 * send both so retries of the same logical payout collapse on their
 * side regardless of which dedup mechanism they honour.
 *
 * Amount unit: NGN in major units (not kobo). Do not multiply by 100.
 *
 * Error surface is preserved: `PayoutError` (retryable flag derived
 * from HTTP status) for call-sites; orchestrator's retry/failover logic
 * is unchanged.
 */

interface BudPayConfig {
  secretKey: string
  apiUrl: string
  isMock: boolean
}

export function validateBudPayConfig(): BudPayConfig {
  const secretKey = process.env.BUDPAY_SECRET_KEY
  const apiUrl = process.env.BUDPAY_API_URL
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && !secretKey) {
    throw new Error(
      'BudPay config missing in production: BUDPAY_SECRET_KEY',
    )
  }

  return {
    secretKey: secretKey ?? '',
    apiUrl: apiUrl ?? 'https://api.budpay.com',
    isMock: !secretKey,
  }
}

// Module-scoped so the "dev stub payout" notice fires once per process,
// even across multiple BudPayProvider instances. Tests that construct a
// fresh provider per case will only see the log on the first instance.
let devStubPayoutLogged = false

export class BudPayProvider implements PayoutProvider {
  readonly name = 'BUDPAY' as const
  private readonly config: Pick<BudPayConfig, 'secretKey' | 'apiUrl'>

  constructor(config: Pick<BudPayConfig, 'secretKey' | 'apiUrl'>) {
    this.config = config
  }

  /**
   * Stub-mode gate. Two triggers:
   *   1. `KOLA_USE_STUB_PROVIDERS=true` — explicit opt-in for dev/test.
   *   2. Missing secret key in non-production — convenience default.
   *
   * Both are guarded against production: stub success cannot be
   * manufactured against real customer money. If either trigger fires
   * in production, this method throws before the stub path is taken.
   */
  private inStubMode(): boolean {
    if (isStubProvidersEnabled()) {
      // Throws in production with a flag-specific message.
      assertStubProvidersSafe()
      return true
    }
    if (!this.config.secretKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'BudPay stub path hit in production — BUDPAY_SECRET_KEY is missing',
        )
      }
      return true
    }
    return false
  }

  private logStubOnce(): void {
    if (!devStubPayoutLogged) {
      console.log('[budpay-dev] initiatePayout -> stub (no network)')
      devStubPayoutLogged = true
    }
  }

  async initiatePayout(params: PayoutParams): Promise<PayoutResult> {
    if (this.inStubMode()) {
      this.logStubOnce()
      return {
        providerRef: `STUB-BP-${params.reference}`,
        status: 'success',
      }
    }

    const body = {
      currency: params.currency,
      // Major units — BudPay uses NGN not kobo. Stringify to preserve
      // decimal precision through the wire.
      amount: params.amount.toFixed(2),
      bank_code: params.bankCode,
      account_number: params.accountNumber,
      narration: `Kolaleaf payout to ${params.recipientName}`,
      reference: params.reference,
      metadata: {
        transferId: params.transferId,
        recipientName: params.recipientName,
      },
    }

    const response = await withRetry(
      (signal) =>
        this.request('POST', '/api/v2/bank_transfer', body, {
          idempotencyKey: params.reference,
          signal,
        }),
      { shouldRetry: budpayShouldRetry },
    )

    // BudPay's `data.reference` echoes our reference back; treat that as
    // the providerRef for downstream correlation (webhook + reconciliation
    // both key off it).
    const providerRef = String(response.data.reference ?? params.reference)
    return {
      providerRef,
      status: String(response.data.status ?? 'pending'),
    }
  }

  async getPayoutStatus(providerRef: string): Promise<PayoutStatusResult> {
    if (this.inStubMode()) {
      return { status: 'success' }
    }

    const response = await withRetry(
      (signal) =>
        this.request(
          'GET',
          `/api/v2/verify-payout/${encodeURIComponent(providerRef)}`,
          undefined,
          { signal },
        ),
      { shouldRetry: budpayShouldRetry },
    )

    const result: PayoutStatusResult = { status: String(response.data.status ?? '') }
    if (response.data.status === 'failed' && response.data.reason) {
      result.failureReason = String(response.data.reason)
    }
    return result
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts: { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<{ status: boolean; data: Record<string, unknown> }> {
    let response: Response
    try {
      response = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          'Content-Type': 'application/json',
          ...(opts.idempotencyKey
            ? { 'Idempotency-Key': opts.idempotencyKey }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new PayoutError(
        'BUDPAY',
        `Network error: ${String(err)}`,
        true,
      )
    }

    const json = await response.json()

    if (!response.ok) {
      const msg = (json as { message?: string }).message ?? 'Unknown error'
      throw new PayoutError('BUDPAY', msg, response.status >= 500)
    }

    return json as { status: boolean; data: Record<string, unknown> }
  }
}

/**
 * Retry predicate for BudPay. Mirrors the Flutterwave pattern:
 * 5xx → retry via `PayoutError.retryable`, HTTP-layer timeouts retry,
 * permanent errors stop. 4xx stops immediately so the orchestrator can
 * route to failover / manual handling.
 */
function budpayShouldRetry(err: unknown): boolean {
  if (err instanceof HttpTimeoutError) return true
  if (err instanceof ProviderTemporaryError) return true
  if (err instanceof ProviderPermanentError) return false
  if (err instanceof PayoutError) return err.retryable
  if (err instanceof TypeError) return true
  return false
}
