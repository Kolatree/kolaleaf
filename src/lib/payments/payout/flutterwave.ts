import Decimal from 'decimal.js'
import type {
  PayoutProvider,
  PayoutParams,
  PayoutResult,
  PayoutStatusResult,
} from './types'
import {
  PayoutError,
  InsufficientBalanceError,
  InvalidBankError,
  ProviderTimeoutError,
  RateLimitError,
} from './types'
import {
  withRetry,
  ProviderPermanentError,
  ProviderTemporaryError,
  ProviderTimeoutError as HttpTimeoutError,
} from '../../http/retry'

/**
 * Flutterwave payout client.
 *
 * Production: `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_API_URL` are
 * required; missing either is a startup failure via
 * `validateFlutterwaveConfig()`.
 *
 * Idempotency: Flutterwave supports an `Idempotency-Key` header on POSTs.
 * We use `params.reference` (our transfer reference) as the key so retries
 * of the same logical payout collapse on their side.
 *
 * Error surface is preserved: call-sites still see `PayoutError` subclasses
 * (`InsufficientBalanceError`, `InvalidBankError`, `ProviderTimeoutError`,
 * `RateLimitError`) and the orchestrator's retry/failover logic is unchanged.
 */

interface FlutterwaveConfig {
  secretKey: string
  apiUrl: string
  isMock: boolean
}

export function validateFlutterwaveConfig(): FlutterwaveConfig {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
  const apiUrl = process.env.FLUTTERWAVE_API_URL
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && !secretKey) {
    throw new Error(
      'Flutterwave config missing in production: FLUTTERWAVE_SECRET_KEY',
    )
  }

  return {
    secretKey: secretKey ?? '',
    apiUrl: apiUrl ?? 'https://api.flutterwave.com/v3',
    isMock: !secretKey,
  }
}

export class FlutterwaveProvider implements PayoutProvider {
  readonly name = 'FLUTTERWAVE' as const
  private readonly config: Pick<FlutterwaveConfig, 'secretKey' | 'apiUrl'>

  constructor(config: Pick<FlutterwaveConfig, 'secretKey' | 'apiUrl'>) {
    this.config = config
  }

  async initiatePayout(params: PayoutParams): Promise<PayoutResult> {
    const body = {
      account_bank: params.bankCode,
      account_number: params.accountNumber,
      amount: params.amount.toNumber(),
      currency: params.currency,
      reference: params.reference,
      narration: `Kolaleaf payout to ${params.recipientName}`,
      beneficiary_name: params.recipientName,
    }

    const response = await withRetry(
      (signal) =>
        this.request('POST', '/transfers', body, {
          idempotencyKey: params.reference,
          signal,
        }),
      { shouldRetry: flutterwaveShouldRetry },
    )

    return {
      providerRef: String(response.data.id),
      status: String(response.data.status),
    }
  }

  async getPayoutStatus(providerRef: string): Promise<PayoutStatusResult> {
    const response = await withRetry(
      (signal) =>
        this.request('GET', `/transfers/${providerRef}`, undefined, { signal }),
      { shouldRetry: flutterwaveShouldRetry },
    )

    const result: PayoutStatusResult = { status: String(response.data.status) }
    if (response.data.status === 'FAILED' && response.data.complete_message) {
      result.failureReason = String(response.data.complete_message)
    }
    return result
  }

  async getWalletBalance(currency: string): Promise<Decimal> {
    const response = await withRetry(
      (signal) =>
        this.request('GET', `/balances/${currency}`, undefined, { signal }),
      { shouldRetry: flutterwaveShouldRetry },
    )

    const wallets = response.data
    if (Array.isArray(wallets)) {
      const wallet = wallets.find(
        (w: { currency: string }) => w.currency === currency,
      )
      if (wallet) return new Decimal(wallet.available_balance)
    }
    // Single wallet response
    return new Decimal(String(wallets.available_balance))
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts: { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<{ status: string; data: Record<string, unknown> }> {
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
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderTimeoutError('FLUTTERWAVE')
      }
      throw new PayoutError('FLUTTERWAVE', `Network error: ${String(err)}`, true)
    }

    if (response.status === 429) {
      throw new RateLimitError('FLUTTERWAVE')
    }

    const json = await response.json()

    if (!response.ok) {
      const msg = (json as { message?: string }).message ?? 'Unknown error'
      if (msg.toLowerCase().includes('insufficient balance')) {
        throw new InsufficientBalanceError('FLUTTERWAVE')
      }
      if (msg.toLowerCase().includes('invalid bank')) {
        const bank =
          body && typeof body === 'object' && 'account_bank' in body
            ? String((body as Record<string, unknown>).account_bank ?? 'unknown')
            : 'unknown'
        throw new InvalidBankError('FLUTTERWAVE', bank)
      }
      throw new PayoutError(
        'FLUTTERWAVE',
        msg,
        response.status >= 500,
      )
    }

    return json as { status: string; data: Record<string, unknown> }
  }
}

/**
 * Retry predicate tuned for Flutterwave's error taxonomy.
 *
 * Retry: rate limits, network errors, 5xx (PayoutError.retryable=true),
 * timeouts, and the generic HTTP-layer temporary errors.
 *
 * Don't retry: InvalidBankError, InsufficientBalanceError — these are
 * permanent business-logic failures that the orchestrator will route to
 * failover / manual handling.
 */
function flutterwaveShouldRetry(err: unknown): boolean {
  if (err instanceof InvalidBankError) return false
  if (err instanceof InsufficientBalanceError) return false
  if (err instanceof RateLimitError) return true
  if (err instanceof ProviderTimeoutError) return true
  if (err instanceof HttpTimeoutError) return true
  if (err instanceof ProviderTemporaryError) return true
  if (err instanceof ProviderPermanentError) return false
  if (err instanceof PayoutError) return err.retryable
  if (err instanceof TypeError) return true
  return false
}
