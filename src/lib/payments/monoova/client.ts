import Decimal from 'decimal.js'
import {
  withRetry,
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
} from '../../http/retry'

/**
 * Monoova PayID client.
 *
 * Production: `MONOOVA_API_URL` and `MONOOVA_API_KEY` are required; missing
 * either is a startup failure via `validateMonoovaConfig()`.
 *
 * Dev/test: config may be absent. `isMock=true` signals to callers that
 * they should stub rather than hit the network; existing adapter tests
 * still construct `MonoovaHttpClient` directly with explicit creds so
 * they are unaffected.
 *
 * Idempotency: Monoova dedupes PayID creation by the `reference` field
 * (our `payIdReference`), so we rely on that natural key rather than a
 * header. Retries on timeout/5xx therefore cannot produce duplicate PayIDs.
 */

export interface CreatePayIdParams {
  transferId: string
  amount: Decimal
  reference: string
}

export interface CreatePayIdResult {
  payId: string
  payIdReference: string
}

export interface PaymentStatusResult {
  status: string
  amount: number
  receivedAt?: Date
}

export interface MonoovaClient {
  createPayId(params: CreatePayIdParams): Promise<CreatePayIdResult>
  getPaymentStatus(payIdReference: string): Promise<PaymentStatusResult>
}

export interface MonoovaConfig {
  apiUrl: string
  apiKey: string
  isMock: boolean
}

export function validateMonoovaConfig(): MonoovaConfig {
  const apiUrl = process.env.MONOOVA_API_URL
  const apiKey = process.env.MONOOVA_API_KEY
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && (!apiUrl || !apiKey)) {
    throw new Error(
      'Monoova config missing in production: MONOOVA_API_URL, MONOOVA_API_KEY',
    )
  }

  return {
    apiUrl: apiUrl ?? '',
    apiKey: apiKey ?? '',
    isMock: !apiUrl || !apiKey,
  }
}

// Module-load validation: fail fast in production if env vars are absent.
export const monoovaConfig = validateMonoovaConfig()

export class MonoovaHttpClient implements MonoovaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async createPayId(params: CreatePayIdParams): Promise<CreatePayIdResult> {
    const data = await withRetry<{
      payId?: string
      payIdReference?: string
    }>((signal) => this.request('POST', '/payid/create', {
      body: {
        transferId: params.transferId,
        amount: params.amount.toNumber(),
        reference: params.reference,
      },
      signal,
    }))

    if (!data.payId || !data.payIdReference) {
      throw new Error('Invalid Monoova response: missing payId')
    }

    return { payId: data.payId, payIdReference: data.payIdReference }
  }

  async getPaymentStatus(payIdReference: string): Promise<PaymentStatusResult> {
    const data = await withRetry<{
      status?: string
      amount?: number
      receivedAt?: string
    }>((signal) =>
      this.request(
        'GET',
        `/payid/status/${encodeURIComponent(payIdReference)}`,
        { signal },
      ),
    )

    return {
      status: String(data.status ?? ''),
      amount: Number(data.amount ?? 0),
      receivedAt: data.receivedAt ? new Date(data.receivedAt) : undefined,
    }
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    } catch (err) {
      // Re-throw DOMException/AbortError so withRetry can translate it
      // into a typed ProviderTimeoutError; other network failures become
      // ProviderTemporaryError so they get retried.
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new ProviderTemporaryError(
        `Monoova network error: ${String(err)}`,
      )
    }

    if (!response.ok) {
      // Preserve the legacy error message shape for existing callers.
      throw errorForStatus(
        response.status,
        `Monoova API error: ${response.status}`,
      )
    }

    try {
      return (await response.json()) as T
    } catch (err) {
      throw new ProviderPermanentError(
        `Monoova response parse error: ${String(err)}`,
      )
    }
  }
}

export function createMonoovaClient(): MonoovaClient {
  const { apiUrl, apiKey, isMock } = monoovaConfig
  if (isMock) {
    // In dev/test without creds, construction is still permitted so
    // call-sites that stub `MonoovaClient` can work. Calls to the real
    // API would fail with a 401 from Monoova — that's by design.
    throw new Error(
      'Monoova client requested but MONOOVA_API_URL/MONOOVA_API_KEY are missing',
    )
  }
  return new MonoovaHttpClient(apiUrl, apiKey)
}
