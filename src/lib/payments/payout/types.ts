import type { Decimal } from 'decimal.js'

export interface PayoutParams {
  transferId: string
  amount: Decimal
  currency: string
  bankCode: string
  accountNumber: string
  recipientName: string
  reference: string
}

export interface PayoutResult {
  providerRef: string
  status: string
}

export interface PayoutStatusResult {
  status: string
  failureReason?: string
}

export interface PayoutProvider {
  name: 'FLUTTERWAVE' | 'PAYSTACK'
  initiatePayout(params: PayoutParams): Promise<PayoutResult>
  getPayoutStatus(providerRef: string): Promise<PayoutStatusResult>
}

export class PayoutError extends Error {
  constructor(
    public provider: string,
    message: string,
    public retryable: boolean = false,
  ) {
    super(message)
    this.name = 'PayoutError'
  }
}

export class InsufficientBalanceError extends PayoutError {
  constructor(provider: string) {
    super(provider, 'Insufficient balance for payout', false)
    this.name = 'InsufficientBalanceError'
  }
}

export class InvalidBankError extends PayoutError {
  constructor(provider: string, bankCode: string) {
    super(provider, `Invalid bank code: ${bankCode}`, false)
    this.name = 'InvalidBankError'
  }
}

export class ProviderTimeoutError extends PayoutError {
  constructor(provider: string) {
    super(provider, 'Provider API timed out', true)
    this.name = 'ProviderTimeoutError'
  }
}

export class RateLimitError extends PayoutError {
  constructor(provider: string) {
    super(provider, 'Rate limit exceeded', true)
    this.name = 'RateLimitError'
  }
}

export function generatePayoutReference(transferId: string): string {
  return `KL-PO-${transferId}-${Date.now()}`
}
