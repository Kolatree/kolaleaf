import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'
import { computeDiscrepancies } from '@/lib/reconciliation/diff'
import { MonoovaStatementClient } from '@/lib/reconciliation/monoova-statement-client'
import { createFlutterwaveStatementClient } from '@/lib/reconciliation/flutterwave-statement-client'
import { createPaystackStatementClient } from '@/lib/reconciliation/paystack-statement-client'
import type {
  Discrepancy,
  ProviderName,
  StatementClient,
  StatementEntry,
} from '@/lib/reconciliation/types'

// GET/POST /api/cron/provider-reconciliation
//
// Step 29 — closes Wave 1 audit P0 gap #3. Pulls today's statements
// from every configured external provider (Monoova AUD credits +
// Flutterwave / Paystack NGN debits), diffs them against the
// internal Transfer ledger for the same window, and creates a
// SUSPICIOUS ComplianceReport row per discrepancy.
//
// Kept DELIBERATELY separate from /api/cron/reconciliation so a
// provider outage here cannot block internal-ledger hygiene (expiry,
// stuck-payout flagging) in the other cron. They share no state.
//
// Time window: trailing WINDOW_HOURS from now. Configurable via env
// (RECONCILIATION_WINDOW_HOURS) so ops can widen the window when
// backfilling after an outage.
//
// Auth: CRON_SECRET bearer token, matching the existing cron routes.
// In production the secret must be set; if absent we skip the auth
// check but still run (useful for first-time setup before secrets
// are wired — the endpoint is rate-limited only by cron schedule).

const DEFAULT_WINDOW_HOURS = 24

interface ProviderResult {
  provider: ProviderName
  entries: number
  error?: string
}

interface ReconciliationOutcome {
  windowStart: string
  windowEnd: string
  providers: ProviderResult[]
  discrepancies: number
  discrepancyBreakdown: Record<Discrepancy['kind'], number>
}

async function safeFetch(
  client: StatementClient,
  from: Date,
  to: Date,
): Promise<{ entries: StatementEntry[]; error?: string }> {
  try {
    const entries = await client.fetchStatement(from, to)
    return { entries }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', 'provider_reconciliation.fetch_failed', {
      provider: client.provider,
      error: message,
    })
    // Don't abort the whole reconciliation — one provider down
    // shouldn't mask discrepancies from the others.
    return { entries: [], error: message }
  }
}

async function handle(request: Request): Promise<NextResponse> {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const windowHours = Number(
    process.env.RECONCILIATION_WINDOW_HOURS ?? DEFAULT_WINDOW_HOURS,
  )
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000)

  // Parallel fetch — independent networks, independent providers.
  // One's failure cannot block the others.
  const [monoova, flutterwave, paystack] = await Promise.all([
    safeFetch(MonoovaStatementClient.fromEnv(), windowStart, windowEnd),
    safeFetch(createFlutterwaveStatementClient(), windowStart, windowEnd),
    safeFetch(createPaystackStatementClient(), windowStart, windowEnd),
  ])

  // Pull Transfers that could plausibly match any of the entries —
  // createdAt within the window is too narrow (a credit can arrive
  // days after the Transfer was created). Use updatedAt >= windowStart
  // for the debit side (payout timestamps recent) and include
  // payidProviderRef-having rows regardless of age for the credit
  // side (customers sometimes pay late).
  const transfers = await prisma.transfer.findMany({
    where: {
      OR: [
        { payidProviderRef: { not: null } },
        { payoutProviderRef: { not: null } },
      ],
    },
  })

  const allEntries = [
    ...monoova.entries,
    ...flutterwave.entries,
    ...paystack.entries,
  ]

  const discrepancies = computeDiscrepancies({ entries: allEntries, transfers })

  const breakdown: Record<Discrepancy['kind'], number> = {
    missing_in_ledger: 0,
    missing_in_statement: 0,
    amount_mismatch: 0,
  }

  for (const d of discrepancies) {
    breakdown[d.kind] += 1
    try {
      await prisma.complianceReport.create({
        data: {
          type: 'SUSPICIOUS',
          userId: 'transferId' in d
            ? transfers.find((t) => t.id === d.transferId)?.userId ?? null
            : null,
          transferId: 'transferId' in d ? d.transferId : null,
          details: {
            source: 'provider_reconciliation',
            kind: d.kind,
            provider: d.provider,
            providerRef: d.providerRef,
            direction: 'direction' in d ? d.direction : null,
            expectedAmount: 'expectedAmount' in d ? d.expectedAmount : null,
            actualAmount: 'actualAmount' in d ? d.actualAmount : null,
            amount: 'amount' in d ? d.amount : null,
            currency: d.currency,
            occurredAt: 'occurredAt' in d ? d.occurredAt.toISOString() : null,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            checkedAt: new Date().toISOString(),
          },
        },
      })
    } catch (err) {
      // A ComplianceReport write failure cannot silence the signal —
      // still log the discrepancy so ops has a durable record.
      log('error', 'provider_reconciliation.report_failed', {
        kind: d.kind,
        provider: d.provider,
        providerRef: d.providerRef,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const outcome: ReconciliationOutcome = {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    providers: [
      { provider: 'monoova', entries: monoova.entries.length, ...(monoova.error ? { error: monoova.error } : {}) },
      { provider: 'flutterwave', entries: flutterwave.entries.length, ...(flutterwave.error ? { error: flutterwave.error } : {}) },
      { provider: 'paystack', entries: paystack.entries.length, ...(paystack.error ? { error: paystack.error } : {}) },
    ],
    discrepancies: discrepancies.length,
    discrepancyBreakdown: breakdown,
  }

  log('info', 'provider_reconciliation.done', { ...outcome })

  return NextResponse.json(outcome)
}

export async function POST(request: Request) {
  return handle(request)
}

export async function GET(request: Request) {
  return handle(request)
}
