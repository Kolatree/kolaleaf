import crypto from 'crypto'

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
    body?: object
  ): Promise<T> {
    const ts = Math.floor(Date.now() / 1000)
    const bodyStr = body ? JSON.stringify(body) : undefined
    const signature = this.signRequest(method, path, ts, bodyStr)

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': this.appToken,
        'X-App-Access-Sig': signature,
        'X-App-Access-Ts': String(ts),
      },
      body: bodyStr,
    })

    if (!response.ok) {
      throw new Error(`Sumsub API error: ${response.status}`)
    }

    return response.json() as Promise<T>
  }

  async createApplicant(params: CreateApplicantParams): Promise<CreateApplicantResult> {
    const path = `/resources/applicants?levelName=${this.levelName}`
    const data = await this.request<{ id?: string }>('POST', path, {
      externalUserId: params.userId,
      email: params.email,
      fixedInfo: { firstName: params.fullName },
    })

    if (!data.id) {
      throw new Error('Invalid Sumsub response: missing applicant id')
    }

    return { applicantId: data.id }
  }

  async getAccessToken(applicantId: string): Promise<AccessTokenResult> {
    const path = `/resources/accessTokens?userId=${applicantId}&levelName=${this.levelName}`
    const data = await this.request<{ token?: string }>('POST', path)

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
    const data = await this.request<{
      reviewStatus?: string
      reviewResult?: { reviewAnswer: string; rejectLabels?: string[] }
    }>('GET', path)

    return {
      status: data.reviewStatus ?? 'unknown',
      reviewResult: data.reviewResult,
    }
  }
}

export function createSumsubClient(): SumsubClient {
  const apiUrl = process.env.SUMSUB_API_URL
  const appToken = process.env.SUMSUB_APP_TOKEN
  const secretKey = process.env.SUMSUB_SECRET_KEY
  const levelName = process.env.SUMSUB_LEVEL_NAME

  if (!apiUrl || !appToken || !secretKey || !levelName) {
    throw new Error(
      'Missing Sumsub environment variables: SUMSUB_API_URL, SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY, SUMSUB_LEVEL_NAME'
    )
  }

  return new SumsubHttpClient(apiUrl, appToken, secretKey, levelName)
}
