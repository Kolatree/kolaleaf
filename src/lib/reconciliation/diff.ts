import Decimal from 'decimal.js'
import type { StatementEntry, Discrepancy, ProviderName } from './types'
import type { Transfer } from '@/generated/prisma/client'

// Pure diff engine for the reconciliation job. Given the statement
// entries pulled from a provider (Monoova inbound credits,
// Flutterwave/Paystack outbound debits) and the Transfer rows from
// our ledger in the same window, emit the set of discrepancies that
// compliance-ops must triage.
//
// The function is deterministic over its inputs and performs NO IO —
// callers are responsible for fetching entries + transfers and for
// persisting the returned discrepancies.

const INBOUND_EXPECTED_STATUSES = new Set<string>([
  'AUD_RECEIVED',
  'PROCESSING_NGN',
  'NGN_SENT',
  'COMPLETED',
])

const OUTBOUND_EXPECTED_STATUSES = new Set<string>(['NGN_SENT', 'COMPLETED'])

function payoutProviderToName(p: Transfer['payoutProvider']): ProviderName | null {
  if (p === 'FLUTTERWAVE') return 'flutterwave'
  if (p === 'PAYSTACK') return 'paystack'
  return null
}

export function computeDiscrepancies(input: {
  entries: StatementEntry[]
  transfers: Transfer[]
}): Discrepancy[] {
  const { entries, transfers } = input
  const discrepancies: Discrepancy[] = []

  // Track which entries we have matched to a Transfer so the
  // per-transfer pass can skip "missing_in_statement" on the same
  // reference. Keyed by providerRef within direction scope.
  const matchedCreditRefs = new Set<string>()
  const matchedDebitRefs = new Set<string>()

  // Build lookup maps for transfers keyed by the reference the
  // statement entry would carry. Using Maps preserves insertion order
  // for determinism when iterating, but we only read by key.
  const transfersByPayidRef = new Map<string, Transfer>()
  const transfersByPayoutRef = new Map<string, Transfer>()
  for (const t of transfers) {
    if (t.payidProviderRef) transfersByPayidRef.set(t.payidProviderRef, t)
    if (t.payoutProviderRef) transfersByPayoutRef.set(t.payoutProviderRef, t)
  }

  // Pass 1 — walk the provider statement. Every entry must either
  // match a Transfer (amount equal) or be flagged as orphaned.
  for (const entry of entries) {
    if (entry.direction === 'credit') {
      const transfer = transfersByPayidRef.get(entry.providerRef)
      if (!transfer) {
        discrepancies.push({
          kind: 'missing_in_ledger',
          provider: entry.provider,
          providerRef: entry.providerRef,
          amount: entry.amount.toString(),
          currency: entry.currency,
          direction: 'credit',
          occurredAt: entry.occurredAt,
        })
        continue
      }
      matchedCreditRefs.add(entry.providerRef)
      const expected = new Decimal(transfer.sendAmount as unknown as Decimal.Value)
      if (!entry.amount.eq(expected)) {
        discrepancies.push({
          kind: 'amount_mismatch',
          provider: entry.provider,
          providerRef: entry.providerRef,
          transferId: transfer.id,
          expectedAmount: expected.toString(),
          actualAmount: entry.amount.toString(),
          currency: entry.currency,
          direction: 'credit',
        })
      }
    } else {
      // debit
      const transfer = transfersByPayoutRef.get(entry.providerRef)
      if (!transfer) {
        discrepancies.push({
          kind: 'missing_in_ledger',
          provider: entry.provider,
          providerRef: entry.providerRef,
          amount: entry.amount.toString(),
          currency: entry.currency,
          direction: 'debit',
          occurredAt: entry.occurredAt,
        })
        continue
      }
      matchedDebitRefs.add(entry.providerRef)
      const expected = new Decimal(transfer.receiveAmount as unknown as Decimal.Value)
      if (!entry.amount.eq(expected)) {
        discrepancies.push({
          kind: 'amount_mismatch',
          provider: entry.provider,
          providerRef: entry.providerRef,
          transferId: transfer.id,
          expectedAmount: expected.toString(),
          actualAmount: entry.amount.toString(),
          currency: entry.currency,
          direction: 'debit',
        })
      }
    }
  }

  // Pass 2 — walk the ledger. Any Transfer that is in a state where
  // we expect a statement record but none appeared gets flagged.
  for (const transfer of transfers) {
    // Inbound credit expectation (Monoova).
    if (
      transfer.payidProviderRef &&
      INBOUND_EXPECTED_STATUSES.has(transfer.status as unknown as string) &&
      !matchedCreditRefs.has(transfer.payidProviderRef)
    ) {
      discrepancies.push({
        kind: 'missing_in_statement',
        provider: 'monoova',
        providerRef: transfer.payidProviderRef,
        transferId: transfer.id,
        expectedAmount: new Decimal(
          transfer.sendAmount as unknown as Decimal.Value,
        ).toString(),
        currency: transfer.sendCurrency,
        direction: 'credit',
      })
    }

    // Outbound debit expectation (Flutterwave or Paystack).
    const payoutName = payoutProviderToName(transfer.payoutProvider)
    if (
      payoutName &&
      transfer.payoutProviderRef &&
      OUTBOUND_EXPECTED_STATUSES.has(transfer.status as unknown as string) &&
      !matchedDebitRefs.has(transfer.payoutProviderRef)
    ) {
      discrepancies.push({
        kind: 'missing_in_statement',
        provider: payoutName,
        providerRef: transfer.payoutProviderRef,
        transferId: transfer.id,
        expectedAmount: new Decimal(
          transfer.receiveAmount as unknown as Decimal.Value,
        ).toString(),
        currency: transfer.receiveCurrency,
        direction: 'debit',
      })
    }
  }

  return discrepancies
}
