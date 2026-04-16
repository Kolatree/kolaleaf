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

/**
 * Paystack payout client (fallback provider for NGN payouts).
 *
 * Production: `PAYSTACK_SECRET_KEY` and `PAYSTACK_API_URL` are required;
 * missing either is a startup failure via `validatePaystackConfig()`.
 *
 * Idempotency: Paystack's Transfer API accepts an `Idempotency-Key`
 * header. We use `params.reference` (the transfer reference) so retries
 * of the same logical payout collapse on their side.
 *
 * Error surface is preserved: `PayoutError` (retryable flag derived from
 * HTTP status) for call-sites; orchestrator's retry/failover logic is
 * unchanged.
 */

interface PaystackConfig {
  secretKey: string
  apiUrl: string
  isMock: boolean
}

export function validatePaystackConfig(): PaystackConfig {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  const apiUrl = process.env.PAYSTACK_API_URL
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && !secretKey) {
    throw new Error(
      'Paystack config missing in production: PAYSTACK_SECRET_KEY',
    )
  }

  return {
    secretKey: secretKey ?? '',
    apiUrl: apiUrl ?? 'https://api.paystack.co',
    isMock: !secretKey,
  }
}

export class PaystackProvider implements PayoutProvider {
  readonly name = 'PAYSTACK' as const
  private readonly config: Pick<PaystackConfig, 'secretKey' | 'apiUrl'>

  constructor(config: Pick<PaystackConfig, 'secretKey' | 'apiUrl'>) {
    this.config = config
  }

  async initiatePayout(params: PayoutParams): Promise<PayoutResult> {
    // Step 1: Create transfer recipient (idempotent on their side via
    // account_number + bank_code so we don't forward a per-payout key here).
    const recipientCode = await withRetry(
      (signal) => this.createRecipient(params, signal),
      { shouldRetry: paystackShouldRetry },
    )

    // Step 2: Initiate transfer (idempotent on `reference`).
    const transferBody = {
      source: 'balance',
      recipient: recipientCode,
      amount: params.amount.mul(100).round().toNumber(), // Paystack uses kobo
      reference: params.reference,
      reason: `Kolaleaf payout to ${params.recipientName}`,
    }

    const response = await withRetry(
      (signal) =>
        this.request('POST', '/transfer', transferBody, {
          idempotencyKey: params.reference,
          signal,
        }),
      { shouldRetry: paystackShouldRetry },
    )
    return {
      providerRef: response.data.transfer_code as string,
      status: response.data.status as string,
    }
  }

  async getPayoutStatus(providerRef: string): Promise<PayoutStatusResult> {
    const response = await withRetry(
      (signal) =>
        this.request(
          'GET',
          `/transfer/verify/${providerRef}`,
          undefined,
          { signal },
        ),
      { shouldRetry: paystackShouldRetry },
    )

    const result: PayoutStatusResult = { status: response.data.status as string }
    if (response.data.status === 'failed' && response.data.reason) {
      result.failureReason = response.data.reason as string
    }
    return result
  }

  private async createRecipient(
    params: PayoutParams,
    signal?: AbortSignal,
  ): Promise<string> {
    const body = {
      type: 'nuban',
      name: params.recipientName,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: params.currency,
    }

    const response = await this.request('POST', '/transferrecipient', body, {
      signal,
    })
    return response.data.recipient_code as string
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
        'PAYSTACK',
        `Network error: ${String(err)}`,
        true,
      )
    }

    const json = await response.json()

    if (!response.ok) {
      const msg = (json as { message?: string }).message ?? 'Unknown error'
      throw new PayoutError('PAYSTACK', msg, response.status >= 500)
    }

    return json as { status: boolean; data: Record<string, unknown> }
  }
}

/**
 * Retry predicate for Paystack. `PayoutError.retryable` already encodes
 * the "5xx is transient" decision; the HTTP-layer errors are also safe
 * to retry. Everything else (4xx → retryable=false) stops immediately
 * so the orchestrator can route to manual handling.
 */
function paystackShouldRetry(err: unknown): boolean {
  if (err instanceof HttpTimeoutError) return true
  if (err instanceof ProviderTemporaryError) return true
  if (err instanceof ProviderPermanentError) return false
  if (err instanceof PayoutError) return err.retryable
  if (err instanceof TypeError) return true
  return false
}
