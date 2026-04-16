import { createHash } from 'node:crypto'
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
  AccountNotFoundError,
} from './types'
import {
  withRetry,
  ProviderPermanentError,
  ProviderTemporaryError,
  ProviderTimeoutError as HttpTimeoutError,
} from '../../http/retry'

/**
 * Hardcoded NG bank list used in dev/test when `FLUTTERWAVE_SECRET_KEY` is
 * absent. Production always fetches the live list from Flutterwave.
 *
 * This exists so local dev (and CI without a prod secret) can render a
 * realistic bank dropdown without reaching out to the network. Covers the
 * Tier-1 retail + mobile-money banks that matter for Nigerian remittance.
 */
export const NG_BANKS_FALLBACK = [
  { name: 'Access Bank', code: '044' },
  { name: 'EcoBank', code: '050' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank', code: '011' },
  { name: 'First City Monument Bank (FCMB)', code: '214' },
  { name: 'GTBank', code: '058' },
  { name: 'Jaiz Bank', code: '301' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Kuda Microfinance Bank', code: '50211' },
  { name: 'Moniepoint Microfinance Bank', code: '50515' },
  { name: 'OPay', code: '999992' },
  { name: 'PalmPay', code: '999991' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'Union Bank', code: '032' },
  { name: 'United Bank for Africa (UBA)', code: '033' },
  { name: 'Unity Bank', code: '215' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
] as const

export interface BankListEntry {
  name: string
  code: string
}

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

const BANKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
// Intentionally module-scoped so the "dev fallback" notice fires once per
// process, even across multiple FlutterwaveProvider instances. Tests that
// construct a fresh provider per case will only see the log on the first
// instance — by design, not a test gap.
let devListBanksLogged = false

interface BanksCacheEntry {
  fetchedAt: number
  banks: BankListEntry[]
}

export class FlutterwaveProvider implements PayoutProvider {
  readonly name = 'FLUTTERWAVE' as const
  private readonly config: Pick<FlutterwaveConfig, 'secretKey' | 'apiUrl'>
  private banksCache: Map<string, BanksCacheEntry> = new Map()

  constructor(config: Pick<FlutterwaveConfig, 'secretKey' | 'apiUrl'>) {
    this.config = config
  }

  /**
   * Returns the bank list for a country. Dev mode (no secret key) returns the
   * hardcoded `NG_BANKS_FALLBACK` and logs once per process. Production hits
   * `/v3/banks/:country` via `withRetry` and caches the result in-memory for
   * 24h (bank lists are near-static).
   */
  async listBanks(country: 'NG'): Promise<BankListEntry[]> {
    if (!this.config.secretKey) {
      if (!devListBanksLogged) {
        // Single-shot notice: helpful in dev, silent in prod (never runs there).
        console.log(`[flutterwave-dev] listBanks(${country}) -> hardcoded`)
        devListBanksLogged = true
      }
      return NG_BANKS_FALLBACK.map((b) => ({ name: b.name, code: b.code }))
    }

    const cached = this.banksCache.get(country)
    if (cached && Date.now() - cached.fetchedAt < BANKS_CACHE_TTL_MS) {
      return cached.banks
    }

    const response = await withRetry(
      (signal) => this.request('GET', `/banks/${country}`, undefined, { signal }),
      { shouldRetry: flutterwaveShouldRetry },
    )

    const raw = response.data as unknown
    const banks: BankListEntry[] = Array.isArray(raw)
      ? raw
          .map((b) => {
            const entry = b as { name?: unknown; code?: unknown }
            return {
              name: typeof entry.name === 'string' ? entry.name : '',
              code: typeof entry.code === 'string' ? entry.code : '',
            }
          })
          .filter((b) => b.name && b.code)
      : []

    this.banksCache.set(country, { fetchedAt: Date.now(), banks })
    return banks
  }

  /**
   * Resolves a bank code + account number to the account holder's canonical
   * name. Dev mode returns a deterministic stub (`DEMO ACCOUNT <last4>`) so
   * local flows work without the provider. Production POSTs to
   * `/v3/accounts/resolve` via `withRetry` with a stable SHA-256 idempotency
   * key so retries of the same resolve don't count twice.
   *
   * Non-200 / `status: "error"` from the provider → `AccountNotFoundError`
   * so the UI can show a specific "account not found" message rather than
   * a generic failure.
   */
  async resolveAccount(input: {
    bankCode: string
    accountNumber: string
  }): Promise<{ accountName: string }> {
    // Normalise here so callers that pass padded input hash to the same
    // idempotency key as callers that pre-trim. The outbound body uses the
    // same normalised values — keep route-layer trimming and adapter-layer
    // trimming agreeing on the canonical form.
    const bankCode = input.bankCode.trim()
    const accountNumber = input.accountNumber.trim()

    if (!this.config.secretKey) {
      const last4 = accountNumber.slice(-4)
      return { accountName: `DEMO ACCOUNT ${last4}` }
    }

    const idempotencyKey = createHash('sha256')
      .update(`${bankCode}:${accountNumber}`)
      .digest('hex')

    let response: { status: string; data: Record<string, unknown> }
    try {
      response = await withRetry(
        (signal) =>
          this.request(
            'POST',
            '/accounts/resolve',
            { account_number: accountNumber, account_bank: bankCode },
            { idempotencyKey, signal },
          ),
        { shouldRetry: flutterwaveShouldRetry },
      )
    } catch (err) {
      // At /accounts/resolve the only meaningful permanent failure is "we
      // couldn't match the account." Map two specific shapes to
      // AccountNotFoundError; everything else (InvalidBankError,
      // InsufficientBalanceError, RateLimitError, ProviderTimeoutError,
      // retryable PayoutError) bubbles so callers see the real failure.
      //
      // 1. ProviderPermanentError from the retry layer (HTTP 4xx without
      //    a provider-specific error class).
      // 2. Generic PayoutError (exact class, NOT a subclass) with
      //    retryable=false — this is what request() throws when
      //    Flutterwave returns a 4xx with a non-matching error message at
      //    this endpoint. The exact-class check guards against a future
      //    non-retryable subclass being silently misclassified as
      //    "account not found."
      if (err instanceof ProviderPermanentError) {
        throw new AccountNotFoundError('FLUTTERWAVE')
      }
      if (
        err instanceof PayoutError &&
        err.constructor === PayoutError &&
        !err.retryable
      ) {
        throw new AccountNotFoundError('FLUTTERWAVE')
      }
      throw err
    }

    if (response.status === 'error') {
      throw new AccountNotFoundError('FLUTTERWAVE')
    }

    const accountName = response.data.account_name
    if (typeof accountName !== 'string' || !accountName.trim()) {
      throw new AccountNotFoundError('FLUTTERWAVE')
    }

    // Do NOT re-case or trim — providers return canonical bank-held names.
    return { accountName }
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

/**
 * Lazy factory for route handlers. Reads env on every call but never validates
 * at module-load time — matches the 15l pattern for build-time safety. In
 * dev/test the secret will be empty and the adapter runs in stub mode.
 */
export function createFlutterwaveProvider(): FlutterwaveProvider {
  return new FlutterwaveProvider({
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? '',
    apiUrl: process.env.FLUTTERWAVE_API_URL ?? 'https://api.flutterwave.com/v3',
  })
}
