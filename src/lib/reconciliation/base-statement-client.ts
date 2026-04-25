import {
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
} from '@/lib/http/retry'
import type { ProviderName, StatementClient, StatementEntry } from './types'

/**
 * Shared base for all reconciliation statement clients.
 *
 * Encapsulates two things every provider client does identically:
 *   1. `request<T>(url, signal)` — fetch with Bearer auth + error
 *      classification into ProviderTemporary / ProviderPermanent.
 *   2. `validateProviderConfig()` — env-var presence check with
 *      production hard-fail and dev/test mock-fallback.
 *
 * Subclasses keep only: URL path construction, response-shape
 * interfaces, status filtering, and normalisation logic.
 */
export abstract class BaseStatementClient implements StatementClient {
  abstract readonly provider: ProviderName

  constructor(
    protected readonly baseUrl: string,
    protected readonly apiKey: string,
  ) {}

  abstract fetchStatement(from: Date, to: Date): Promise<StatementEntry[]>

  protected async request<T>(url: string, signal: AbortSignal): Promise<T> {
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
        `${this.provider} network error: ${String(err)}`,
      )
    }

    if (!response.ok) {
      throw errorForStatus(
        response.status,
        `${this.provider} API error: ${response.status}`,
      )
    }

    try {
      return (await response.json()) as T
    } catch (err) {
      throw new ProviderPermanentError(
        `${this.provider} response parse error: ${String(err)}`,
      )
    }
  }
}

/**
 * Shared env-var validation for statement client factories.
 *
 * In production, missing env vars throw immediately. In dev/test,
 * absence is tolerated and `isMock: true` signals the factory to
 * return a no-op client that yields `[]`.
 */
export function validateProviderConfig(opts: {
  urlEnv: string
  keyEnv: string
  providerName: string
}): { apiUrl: string; apiKey: string; isMock: boolean } {
  const apiUrl = process.env[opts.urlEnv]
  const apiKey = process.env[opts.keyEnv]
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && (!apiUrl || !apiKey)) {
    throw new Error(
      `${opts.providerName} statement config missing in production: ${opts.urlEnv}, ${opts.keyEnv}`,
    )
  }

  return {
    apiUrl: apiUrl ?? '',
    apiKey: apiKey ?? '',
    isMock: !apiUrl || !apiKey,
  }
}
