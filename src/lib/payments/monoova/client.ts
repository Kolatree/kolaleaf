import Decimal from 'decimal.js'

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

export class MonoovaHttpClient implements MonoovaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async createPayId(params: CreatePayIdParams): Promise<CreatePayIdResult> {
    const response = await fetch(`${this.baseUrl}/payid/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transferId: params.transferId,
        amount: params.amount.toNumber(),
        reference: params.reference,
      }),
    })

    if (!response.ok) {
      throw new Error(`Monoova API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.payId || !data.payIdReference) {
      throw new Error('Invalid Monoova response: missing payId')
    }

    return {
      payId: data.payId,
      payIdReference: data.payIdReference,
    }
  }

  async getPaymentStatus(payIdReference: string): Promise<PaymentStatusResult> {
    const response = await fetch(
      `${this.baseUrl}/payid/status/${encodeURIComponent(payIdReference)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Monoova API error: ${response.status}`)
    }

    const data = await response.json()

    return {
      status: data.status,
      amount: data.amount,
      receivedAt: data.receivedAt ? new Date(data.receivedAt) : undefined,
    }
  }
}

export function createMonoovaClient(): MonoovaClient {
  const apiUrl = process.env.MONOOVA_API_URL
  const apiKey = process.env.MONOOVA_API_KEY

  if (!apiUrl || !apiKey) {
    throw new Error('Missing MONOOVA_API_URL or MONOOVA_API_KEY environment variables')
  }

  return new MonoovaHttpClient(apiUrl, apiKey)
}
