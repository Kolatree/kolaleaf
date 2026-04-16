import crypto from 'crypto'
import {
  withRetry,
  errorForStatus,
  ProviderPermanentError,
  ProviderTemporaryError,
} from '../../http/retry'

/**
 * Sumsub KYC client.
 *
 * Production: `SUMSUB_API_URL`, `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`,
 * and `SUMSUB_LEVEL_NAME` are all required; missing any is a startup
 * failure via `validateSumsubConfig()`.
 *
 * Dev/test: all four may be absent. `isMock=true` signals to callers that
 * they should stub rather than hit the network.
 *
 * Idempotency: Sumsub dedupes applicants by `externalUserId` (our `userId`),
 * and access-token/status reads are naturally idempotent, so we rely on
 * those natural keys rather than a header. Retries therefore cannot
 * produce duplicate applicants.
 */

export interface CreateApplicantParams {
  userId: string
  email: string
  fullName: string
}

export interface CreateApplicantResult {
  applicantId: string
}

export interface AccessTokenResult {
  token: string
  url: string
}

export interface ApplicantStatusResult {
  status: string
  reviewResult?: {
    reviewAnswer: string
    rejectLabels?: string[]
  }
}

export interface SumsubClient {
  createApplicant(params: CreateApplicantParams): Promise<CreateApplicantResult>
  getAccessToken(applicantId: string): Promise<AccessTokenResult>
  getApplicantStatus(applicantId: string): Promise<ApplicantStatusResult>
}

export interface SumsubConfig {
  apiUrl: string
  appToken: string
  secretKey: string
  levelName: string
  isMock: boolean
}

export function validateSumsubConfig(): SumsubConfig {
  const apiUrl = process.env.SUMSUB_API_URL
  const appToken = process.env.SUMSUB_APP_TOKEN
  const secretKey = process.env.SUMSUB_SECRET_KEY
  const levelName = process.env.SUMSUB_LEVEL_NAME
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && (!apiUrl || !appToken || !secretKey || !levelName)) {
    throw new Error(
      'Sumsub config missing in production: SUMSUB_API_URL, SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY, SUMSUB_LEVEL_NAME',
    )
  }

  return {
    apiUrl: apiUrl ?? '',
    appToken: appToken ?? '',
    secretKey: secretKey ?? '',
    levelName: levelName ?? '',
    isMock: !apiUrl || !appToken || !secretKey || !levelName,
  }
}

// Module-load validation: fail fast in production if env vars are absent.
export const sumsubConfig = validateSumsubConfig()

export class SumsubHttpClient implements SumsubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly appToken: string,
    private readonly secretKey: string,
    private readonly levelName: string
  ) {}

  private signRequest(
    method: string,
    path: string,
    ts: number,
    body?: string
  ): string {
    const data = `${ts}${method.toUpperCase()}${path}${body ?? ''}`
    return crypto.createHmac('sha256', this.secretKey).update(data).digest('hex')
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const ts = Math.floor(Date.now() / 1000)
    const bodyStr = body ? JSON.stringify(body) : undefined
    const signature = this.signRequest(method, path, ts, bodyStr)

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-App-Token': this.appToken,
          'X-App-Access-Sig': signature,
          'X-App-Access-Ts': String(ts),
        },
        body: bodyStr,
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new ProviderTemporaryError(
        `Sumsub network error: ${String(err)}`,
      )
    }

    if (!response.ok) {
      throw errorForStatus(
        response.status,
        `Sumsub API error: ${response.status}`,
      )
    }

    try {
      return (await response.json()) as T
    } catch (err) {
      throw new ProviderPermanentError(
        `Sumsub response parse error: ${String(err)}`,
      )
    }
  }

  async createApplicant(params: CreateApplicantParams): Promise<CreateApplicantResult> {
    const path = `/resources/applicants?levelName=${this.levelName}`
    const data = await withRetry<{ id?: string }>((signal) =>
      this.request(
        'POST',
        path,
        {
          externalUserId: params.userId,
          email: params.email,
          fixedInfo: { firstName: params.fullName },
        },
        signal,
      ),
    )

    if (!data.id) {
      throw new Error('Invalid Sumsub response: missing applicant id')
    }

    return { applicantId: data.id }
  }

  async getAccessToken(applicantId: string): Promise<AccessTokenResult> {
    const path = `/resources/accessTokens?userId=${applicantId}&levelName=${this.levelName}`
    const data = await withRetry<{ token?: string }>((signal) =>
      this.request('POST', path, undefined, signal),
    )

    if (!data.token) {
      throw new Error('Invalid Sumsub response: missing access token')
    }

    return {
      token: data.token,
      url: `https://api.sumsub.com/idensic/#/applicant/${applicantId}`,
    }
  }

  async getApplicantStatus(applicantId: string): Promise<ApplicantStatusResult> {
    const path = `/resources/applicants/${applicantId}/one`
    const data = await withRetry<{
      reviewStatus?: string
      reviewResult?: { reviewAnswer: string; rejectLabels?: string[] }
    }>((signal) => this.request('GET', path, undefined, signal))

    return {
      status: data.reviewStatus ?? 'unknown',
      reviewResult: data.reviewResult,
    }
  }
}

export function createSumsubClient(): SumsubClient {
  const { apiUrl, appToken, secretKey, levelName, isMock } = sumsubConfig
  if (isMock) {
    throw new Error(
      'Sumsub client requested but one or more of SUMSUB_API_URL, SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY, SUMSUB_LEVEL_NAME are missing',
    )
  }
  return new SumsubHttpClient(apiUrl, appToken, secretKey, levelName)
}
