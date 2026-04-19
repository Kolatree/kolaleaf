import Decimal from 'decimal.js'
import {
  withRetry,
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
} from '../../http/retry'
import { isStubProvidersEnabled, assertStubProvidersSafe } from '../flag'
import { StubMonoovaClient } from './stub-client'

/**
 * Monoova PayID client.
 *
 * Production: `MONOOVA_API_URL` and `MONOOVA_API_KEY` are required; missing
 * either throws when `createMonoovaClient()` is first called. The check is
 * LAZY (first-use, not module-load) so `next build` can evaluate route
 * modules without throwing before env vars are wired on the host.
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

export class MonoovaHttpClient implements MonoovaClient {
  private readonly authHeader: string

  constructor(
    private readonly baseUrl: string,
    apiKey: string,
  ) {
    // Monoova's real API uses HTTP Basic auth where username = API key
    // and password is blank. Computed once so subsequent requests reuse
    // the same header value.
    this.authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64')
  }

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
          Authorization: this.authHeader,
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
  // Stub escape hatch: `KOLA_USE_STUB_PROVIDERS=true` short-circuits
  // to a zero-network `StubMonoovaClient` so dev can exercise the full
  // CREATED → AWAITING_AUD transition without real Monoova creds. The
  // `assertStubProvidersSafe` guard forbids this path in production so
  // a stray env var cannot manufacture fake success against live users.
  if (isStubProvidersEnabled()) {
    assertStubProvidersSafe()
    return new StubMonoovaClient()
  }

  // Lazy validation: runs on first factory call, NOT at module import. In
  // production this throws with the specific missing-var message; in dev/test
  // without creds we fall back to the stub as a convenience so local ops
  // can run the app without wiring env. Production always requires real
  // creds — `validateMonoovaConfig` throws there when they're missing.
  const { apiUrl, apiKey, isMock } = validateMonoovaConfig()
  if (isMock) {
    if (process.env.NODE_ENV !== 'production') {
      return new StubMonoovaClient()
    }
    throw new Error(
      'Monoova client requested but MONOOVA_API_URL/MONOOVA_API_KEY are missing',
    )
  }
  return new MonoovaHttpClient(apiUrl, apiKey)
}
