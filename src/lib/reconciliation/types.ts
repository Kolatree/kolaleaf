import type Decimal from 'decimal.js'

// Normalized provider-statement entry shape. Every statement client
// (Monoova / Flutterwave / Paystack) produces entries matching this
// contract so the diff engine (diff.ts) can treat them uniformly.
//
// `direction` encodes which side of the ledger the entry belongs to:
//   - 'credit': AUD received from a customer (Monoova)
//   - 'debit':  NGN paid out to a recipient (Flutterwave / Paystack)
// The diff engine uses direction to pick which Transfer field
// (payidProviderRef vs payoutProviderRef) to match on.

export type ProviderName = 'monoova' | 'flutterwave' | 'paystack'
export type StatementDirection = 'credit' | 'debit'

export interface StatementEntry {
  provider: ProviderName
  providerRef: string
  amount: Decimal
  currency: string
  occurredAt: Date
  direction: StatementDirection
  // Preserved raw payload so compliance officers can inspect the
  // source record when a discrepancy is flagged. Never consumed by
  // the diff engine.
  raw?: Record<string, unknown>
}

// Discrepancy kinds emitted by the diff engine.
//
// missing_in_ledger: provider has a record but we have no Transfer
//   row pointing at that providerRef — possible unrecorded customer
//   payment or misrouted webhook.
//
// missing_in_statement: we have a Transfer row expecting a matching
//   provider record in the window, but none appeared — possible
//   stuck-in-flight or provider-side delay.
//
// amount_mismatch: both exist but the amounts disagree — possible
//   FX recalculation drift, partial payment, or fraud signal.

export interface DiscrepancyMissingInLedger {
  kind: 'missing_in_ledger'
  provider: ProviderName
  providerRef: string
  amount: string
  currency: string
  direction: StatementDirection
  occurredAt: Date
}

export interface DiscrepancyMissingInStatement {
  kind: 'missing_in_statement'
  provider: ProviderName
  providerRef: string
  transferId: string
  expectedAmount: string
  currency: string
  direction: StatementDirection
}

export interface DiscrepancyAmountMismatch {
  kind: 'amount_mismatch'
  provider: ProviderName
  providerRef: string
  transferId: string
  expectedAmount: string
  actualAmount: string
  currency: string
  direction: StatementDirection
}

export type Discrepancy =
  | DiscrepancyMissingInLedger
  | DiscrepancyMissingInStatement
  | DiscrepancyAmountMismatch

// Interface that every per-provider statement client satisfies.
// Dev/test clients that lack credentials should either throw at
// construction (matching the lazy-validate pattern in
// src/lib/payments/monoova/client.ts) OR return an empty array —
// never silent mock data that could mask a real reconciliation gap.
export interface StatementClient {
  provider: ProviderName
  fetchStatement(from: Date, to: Date): Promise<StatementEntry[]>
}
