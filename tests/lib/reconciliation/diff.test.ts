import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { computeDiscrepancies } from '../../../src/lib/reconciliation/diff'
import type { StatementEntry } from '../../../src/lib/reconciliation/types'
import type { Transfer } from '../../../src/generated/prisma/client'

// Minimal Transfer factory. The diff engine only reads a handful of
// fields; everything else is padded with sentinel values so we don't
// drag in the full Prisma row shape for pure-function tests.
function makeTransfer(overrides: Partial<Transfer>): Transfer {
  const base = {
    id: 'tr_default',
    userId: 'u_default',
    recipientId: 'r_default',
    corridorId: 'c_default',
    sendAmount: new Decimal('100.00'),
    sendCurrency: 'AUD',
    receiveAmount: new Decimal('100000.00'),
    receiveCurrency: 'NGN',
    exchangeRate: new Decimal('1000.000000'),
    fee: new Decimal('0'),
    status: 'CREATED',
    payidReference: null,
    payidProviderRef: null,
    payoutProvider: null,
    payoutProviderRef: null,
    failureReason: null,
    retryCount: 0,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    completedAt: null,
  } as unknown as Transfer
  return { ...base, ...overrides } as Transfer
}

function makeEntry(overrides: Partial<StatementEntry>): StatementEntry {
  const base: StatementEntry = {
    provider: 'monoova',
    providerRef: 'ref_default',
    amount: new Decimal('100.00'),
    currency: 'AUD',
    occurredAt: new Date('2026-04-01T00:00:00Z'),
    direction: 'credit',
  }
  return { ...base, ...overrides }
}

describe('computeDiscrepancies', () => {
  it('returns empty output for empty inputs', () => {
    const result = computeDiscrepancies({ entries: [], transfers: [] })
    expect(result).toEqual([])
  })

  it('finds no discrepancy when a Monoova credit matches a Transfer exactly', () => {
    const entry = makeEntry({
      provider: 'monoova',
      providerRef: 'MON_001',
      amount: new Decimal('250.00'),
      direction: 'credit',
    })
    const transfer = makeTransfer({
      id: 'tr_1',
      sendAmount: new Decimal('250.00'),
      payidProviderRef: 'MON_001',
      status: 'AUD_RECEIVED',
    })
    const result = computeDiscrepancies({ entries: [entry], transfers: [transfer] })
    expect(result).toEqual([])
  })

  it('emits missing_in_ledger when a Monoova credit has no matching Transfer', () => {
    const entry = makeEntry({
      provider: 'monoova',
      providerRef: 'MON_ORPHAN',
      amount: new Decimal('500.00'),
      direction: 'credit',
      occurredAt: new Date('2026-04-02T09:00:00Z'),
    })
    const result = computeDiscrepancies({ entries: [entry], transfers: [] })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'missing_in_ledger',
      provider: 'monoova',
      providerRef: 'MON_ORPHAN',
      amount: '500',
      currency: 'AUD',
      direction: 'credit',
    })
  })

  it('emits amount_mismatch when Monoova credit amount differs from Transfer.sendAmount', () => {
    const entry = makeEntry({
      provider: 'monoova',
      providerRef: 'MON_002',
      amount: new Decimal('100.00'),
      direction: 'credit',
    })
    const transfer = makeTransfer({
      id: 'tr_mismatch',
      sendAmount: new Decimal('120.00'),
      payidProviderRef: 'MON_002',
      status: 'AUD_RECEIVED',
    })
    const result = computeDiscrepancies({ entries: [entry], transfers: [transfer] })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'amount_mismatch',
      provider: 'monoova',
      providerRef: 'MON_002',
      transferId: 'tr_mismatch',
      expectedAmount: '120',
      actualAmount: '100',
      currency: 'AUD',
      direction: 'credit',
    })
  })

  it('emits missing_in_statement for a COMPLETED transfer with payidProviderRef but no matching credit', () => {
    const transfer = makeTransfer({
      id: 'tr_stuck',
      sendAmount: new Decimal('300.00'),
      payidProviderRef: 'MON_EXPECTED',
      status: 'COMPLETED',
    })
    const result = computeDiscrepancies({ entries: [], transfers: [transfer] })
    const missing = result.filter((d) => d.kind === 'missing_in_statement')
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({
      kind: 'missing_in_statement',
      provider: 'monoova',
      providerRef: 'MON_EXPECTED',
      transferId: 'tr_stuck',
      expectedAmount: '300',
      currency: 'AUD',
      direction: 'credit',
    })
  })

  it('finds no discrepancy when a Flutterwave debit matches a Transfer exactly', () => {
    const entry = makeEntry({
      provider: 'flutterwave',
      providerRef: 'FLW_PAY_01',
      amount: new Decimal('150000.00'),
      currency: 'NGN',
      direction: 'debit',
    })
    const transfer = makeTransfer({
      id: 'tr_flw',
      receiveAmount: new Decimal('150000.00'),
      payoutProvider: 'FLUTTERWAVE',
      payoutProviderRef: 'FLW_PAY_01',
      status: 'COMPLETED',
    })
    const result = computeDiscrepancies({ entries: [entry], transfers: [transfer] })
    expect(result).toEqual([])
  })

  it('emits missing_in_statement (flutterwave) for NGN_SENT transfer with no matching debit entry', () => {
    const transfer = makeTransfer({
      id: 'tr_no_debit',
      receiveAmount: new Decimal('75000.00'),
      payoutProvider: 'FLUTTERWAVE',
      payoutProviderRef: 'FLW_AWOL',
      status: 'NGN_SENT',
      payidProviderRef: null, // isolate the debit-side check
    })
    const result = computeDiscrepancies({ entries: [], transfers: [transfer] })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'missing_in_statement',
      provider: 'flutterwave',
      providerRef: 'FLW_AWOL',
      transferId: 'tr_no_debit',
      expectedAmount: '75000',
      currency: 'NGN',
      direction: 'debit',
    })
  })

  it('does not emit missing_in_statement for a CREATED transfer with no PayID yet', () => {
    const transfer = makeTransfer({
      id: 'tr_new',
      status: 'CREATED',
      payidProviderRef: null,
      payoutProvider: null,
      payoutProviderRef: null,
    })
    const result = computeDiscrepancies({ entries: [], transfers: [transfer] })
    expect(result).toEqual([])
  })

  it('treats amounts as equal across trailing-zero representations (10 === 10.00)', () => {
    // Guardrail for the spec rule "do NOT use .toString() ===".
    const entry = makeEntry({
      provider: 'monoova',
      providerRef: 'MON_EQ',
      amount: new Decimal('10'),
      direction: 'credit',
    })
    const transfer = makeTransfer({
      id: 'tr_eq',
      sendAmount: new Decimal('10.00'),
      payidProviderRef: 'MON_EQ',
      status: 'AUD_RECEIVED',
    })
    const result = computeDiscrepancies({ entries: [entry], transfers: [transfer] })
    expect(result).toEqual([])
  })

  it('does not mis-match a debit entry when Flutterwave and BudPay collide on providerRef', () => {
    // Adversarial case: both providers happen to mint the same short
    // alphanumeric ref. Before the composite-key fix, the second
    // transfer inserted into the map would shadow the first, so a
    // BudPay entry could "match" a Flutterwave-paid transfer and
    // silently emit a bogus amount_mismatch.
    const flwTransfer = makeTransfer({
      id: 'tr_flw',
      receiveAmount: new Decimal('100000.00'),
      payoutProvider: 'FLUTTERWAVE',
      payoutProviderRef: 'TXN-12345',
      status: 'COMPLETED',
      payidProviderRef: null,
    })
    const budpayTransfer = makeTransfer({
      id: 'tr_bp',
      receiveAmount: new Decimal('500000.00'),
      payoutProvider: 'BUDPAY',
      payoutProviderRef: 'TXN-12345',
      status: 'COMPLETED',
      payidProviderRef: null,
    })
    const flwEntry = makeEntry({
      provider: 'flutterwave',
      providerRef: 'TXN-12345',
      amount: new Decimal('100000.00'),
      currency: 'NGN',
      direction: 'debit',
    })
    const budpayEntry = makeEntry({
      provider: 'budpay',
      providerRef: 'TXN-12345',
      amount: new Decimal('500000.00'),
      currency: 'NGN',
      direction: 'debit',
    })
    const result = computeDiscrepancies({
      entries: [flwEntry, budpayEntry],
      transfers: [flwTransfer, budpayTransfer],
    })
    expect(result).toEqual([])
  })

  it('suppresses missing_in_statement for a provider whose statement fetch failed', () => {
    // If Flutterwave's fetch errored, absence of its entry proves
    // nothing. Emitting missing_in_statement in that state floods
    // compliance-ops with false positives during every provider
    // outage.
    const transfer = makeTransfer({
      id: 'tr_awol',
      receiveAmount: new Decimal('42000.00'),
      payoutProvider: 'FLUTTERWAVE',
      payoutProviderRef: 'FLW_X',
      status: 'NGN_SENT',
      payidProviderRef: null,
    })
    const result = computeDiscrepancies({
      entries: [],
      transfers: [transfer],
      failedProviders: new Set(['flutterwave']),
    })
    expect(result).toEqual([])
  })

  it('still emits missing_in_statement when the failed provider is someone else', () => {
    // Monoova fetch failed but a Flutterwave-paid transfer should
    // still be flagged if Flutterwave returned nothing.
    const transfer = makeTransfer({
      id: 'tr_live',
      receiveAmount: new Decimal('9000.00'),
      payoutProvider: 'FLUTTERWAVE',
      payoutProviderRef: 'FLW_Y',
      status: 'COMPLETED',
      payidProviderRef: null,
    })
    const result = computeDiscrepancies({
      entries: [],
      transfers: [transfer],
      failedProviders: new Set(['monoova']),
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'missing_in_statement',
      provider: 'flutterwave',
      providerRef: 'FLW_Y',
      transferId: 'tr_live',
    })
  })
})
