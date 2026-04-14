import type {
  PayoutProvider,
  PayoutParams,
  PayoutResult,
  PayoutStatusResult,
} from './types'
import { PayoutError } from './types'

interface PaystackConfig {
  secretKey: string
  apiUrl: string
}

export class PaystackProvider implements PayoutProvider {
  readonly name = 'PAYSTACK' as const
  private readonly config: PaystackConfig

  constructor(config: PaystackConfig) {
    this.config = config
  }

  async initiatePayout(params: PayoutParams): Promise<PayoutResult> {
    // Step 1: Create transfer recipient
    const recipientCode = await this.createRecipient(params)

    // Step 2: Initiate transfer
    const transferBody = {
      source: 'balance',
      recipient: recipientCode,
      amount: params.amount.mul(100).round().toNumber(), // Paystack uses kobo
      reference: params.reference,
      reason: `Kolaleaf payout to ${params.recipientName}`,
    }

    const response = await this.request('POST', '/transfer', transferBody)
    return {
      providerRef: response.data.transfer_code as string,
      status: response.data.status as string,
    }
  }

  async getPayoutStatus(providerRef: string): Promise<PayoutStatusResult> {
    const response = await this.request('GET', `/transfer/verify/${providerRef}`)

    const result: PayoutStatusResult = { status: response.data.status as string }
    if (response.data.status === 'failed' && response.data.reason) {
      result.failureReason = response.data.reason as string
    }
    return result
  }

  private async createRecipient(params: PayoutParams): Promise<string> {
    const body = {
      type: 'nuban',
      name: params.recipientName,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: params.currency,
    }

    const response = await this.request('POST', '/transferrecipient', body)
    return response.data.recipient_code as string
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: boolean; data: Record<string, unknown> }> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    const json = await response.json()

    if (!response.ok) {
      const msg = (json as { message?: string }).message ?? 'Unknown error'
      throw new PayoutError('PAYSTACK', msg, response.status >= 500)
    }

    return json as { status: boolean; data: Record<string, unknown> }
  }
}
