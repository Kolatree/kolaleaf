import Decimal from 'decimal.js'
import type {
  PayoutProvider,
  PayoutParams,
  PayoutResult,
  PayoutStatusResult,
} from './types.js'
import {
  PayoutError,
  InsufficientBalanceError,
  InvalidBankError,
  ProviderTimeoutError,
  RateLimitError,
} from './types.js'

interface FlutterwaveConfig {
  secretKey: string
  apiUrl: string
}

export class FlutterwaveProvider implements PayoutProvider {
  readonly name = 'FLUTTERWAVE' as const
  private readonly config: FlutterwaveConfig

  constructor(config: FlutterwaveConfig) {
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

    const response = await this.request('POST', '/transfers', body)

    return {
      providerRef: String(response.data.id),
      status: response.data.status,
    }
  }

  async getPayoutStatus(providerRef: string): Promise<PayoutStatusResult> {
    const response = await this.request('GET', `/transfers/${providerRef}`)

    const result: PayoutStatusResult = { status: response.data.status }
    if (response.data.status === 'FAILED' && response.data.complete_message) {
      result.failureReason = response.data.complete_message
    }
    return result
  }

  async getWalletBalance(currency: string): Promise<Decimal> {
    const response = await this.request('GET', `/balances/${currency}`)

    const wallets = response.data
    if (Array.isArray(wallets)) {
      const wallet = wallets.find(
        (w: { currency: string }) => w.currency === currency,
      )
      if (wallet) return new Decimal(wallet.available_balance)
    }
    // Single wallet response
    return new Decimal(wallets.available_balance)
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: string; data: Record<string, unknown> }> {
    let response: Response
    try {
      response = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
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
        throw new InvalidBankError('FLUTTERWAVE', body ? (body as Record<string, string>).account_bank : 'unknown')
      }
      throw new PayoutError('FLUTTERWAVE', msg)
    }

    return json as { status: string; data: Record<string, unknown> }
  }
}
