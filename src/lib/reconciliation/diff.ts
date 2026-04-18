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

// Composite key for debit-side lookups. Providers MUST NOT be collapsed
// to providerRef alone because Flutterwave/Paystack can independently
// mint short alphanumeric refs that happen to collide. A collision
// would misroute a debit onto the wrong Transfer (wrong amount → false
// amount_mismatch, or worse, a real fraud signal silently suppressed).
function debitKey(provider: ProviderName, ref: string): string {
  return `${provider}:${ref}`
}

export function computeDiscrepancies(input: {
  entries: StatementEntry[]
  transfers: Transfer[]
  // Providers whose fetch failed in this run. Pass-2 suppresses
  // `missing_in_statement` for these providers because absence of the
  // entry proves nothing — the statement pull itself errored.
  failedProviders?: Set<ProviderName>
}): Discrepancy[] {
  const { entries, transfers, failedProviders } = input
  const failed = failedProviders ?? new Set<ProviderName>()
  const discrepancies: Discrepancy[] = []

  // Track which entries we have matched to a Transfer so the
  // per-transfer pass can skip "missing_in_statement" on the same
  // reference. Credits are Monoova-only so a single namespace is safe.
  // Debits are keyed by `${provider}:${providerRef}` to avoid
  // cross-provider ref collisions.
  const matchedCreditRefs = new Set<string>()
  const matchedDebitRefs = new Set<string>()

  const transfersByPayidRef = new Map<string, Transfer>()
  const transfersByPayoutRef = new Map<string, Transfer>()
  for (const t of transfers) {
    if (t.payidProviderRef) transfersByPayidRef.set(t.payidProviderRef, t)
    const payoutName = payoutProviderToName(t.payoutProvider)
    if (payoutName && t.payoutProviderRef) {
      transfersByPayoutRef.set(debitKey(payoutName, t.payoutProviderRef), t)
    }
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
      // debit — lookup scoped to (provider, ref) so Flutterwave and
      // Paystack cannot shadow each other on colliding refs.
      const key = debitKey(entry.provider, entry.providerRef)
      const transfer = transfersByPayoutRef.get(key)
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
      matchedDebitRefs.add(key)
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
  // Providers whose statement fetch failed are excluded: their absence
  // tells us nothing.
  for (const transfer of transfers) {
    // Inbound credit expectation (Monoova).
    if (
      !failed.has('monoova') &&
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
      !failed.has(payoutName) &&
      transfer.payoutProviderRef &&
      OUTBOUND_EXPECTED_STATUSES.has(transfer.status as unknown as string) &&
      !matchedDebitRefs.has(debitKey(payoutName, transfer.payoutProviderRef))
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
