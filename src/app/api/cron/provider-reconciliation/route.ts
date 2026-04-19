import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'
import { computeDiscrepancies } from '@/lib/reconciliation/diff'
import { MonoovaStatementClient } from '@/lib/reconciliation/monoova-statement-client'
import { createFlutterwaveStatementClient } from '@/lib/reconciliation/flutterwave-statement-client'
import { createBudPayStatementClient } from '@/lib/reconciliation/budpay-statement-client'
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
// BudPay / Flutterwave NGN debits), diffs them against the
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
// Auth: CRON_SECRET bearer token. In production the secret MUST be
// set — a missing secret fails closed (503). In dev/test the check
// is skipped so local ops can exercise the route without wiring env.

const DEFAULT_WINDOW_HOURS = 24
// Transfers older than this are not considered by the diff engine —
// avoids the "COMPLETED 6 months ago re-emits missing_in_statement
// forever" regression path flagged by the Wave 1 review. A late-
// arriving PayID credit beyond this bound is still auditable via the
// raw provider statement + admin tooling.
const MAX_TRANSFER_LOOKBACK_DAYS = 14
// Hard cap on ComplianceReport writes per run. A compromised/drifted
// provider could return a whole-account statement with thousands of
// entries; we must not self-DoS by writing them all serially. On
// overflow a single `reconciliation_overflow` SUSPICIOUS row is
// written so ops still gets paged.
const MAX_DISCREPANCY_WRITES = 500

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
  overflow?: boolean
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
    // shouldn't mask discrepancies from the others. The provider is
    // recorded in `failedProviders` so Pass 2 of the diff engine
    // knows to suppress `missing_in_statement` for it (absence of
    // entry ≠ missing payout when the fetch itself errored).
    return { entries: [], error: message }
  }
}

// Constant-time auth check. Length-mismatch early return is still
// timing-observable but reveals only `authHeader.length`, not the
// secret itself.
function authOk(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Fail-closed in production — a missing secret is a
    // misconfiguration, not a license to accept anonymous calls.
    if (process.env.NODE_ENV === 'production') return false
    return true
  }
  const auth = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  if (auth.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
}

function parseWindowHours(): number {
  const raw = process.env.RECONCILIATION_WINDOW_HOURS
  if (raw === undefined) return DEFAULT_WINDOW_HOURS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log('warn', 'provider_reconciliation.invalid_window_hours', { raw })
    return DEFAULT_WINDOW_HOURS
  }
  return parsed
}

// Dedupe key for a discrepancy — matches the shape we write into
// `ComplianceReport.details` so a pre-query on recent SUSPICIOUS rows
// can spot a same-window duplicate without an index migration.
function dedupeKey(d: Discrepancy): string {
  return `${d.kind}:${d.provider}:${d.providerRef}`
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authOk(request)) {
    const secret = process.env.CRON_SECRET
    // Distinguish misconfiguration (503) from a bad caller (401) so
    // the alerting pipeline can route the two differently.
    if (!secret && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'cron_secret_unset' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const windowHours = parseWindowHours()
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000)
  const transferLookback = new Date(
    windowEnd.getTime() - MAX_TRANSFER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  )

  // Parallel fetch — independent networks, independent providers.
  // One's failure cannot block the others.
  const [monoova, flutterwave, budpay] = await Promise.all([
    safeFetch(MonoovaStatementClient.fromEnv(), windowStart, windowEnd),
    safeFetch(createFlutterwaveStatementClient(), windowStart, windowEnd),
    safeFetch(createBudPayStatementClient(), windowStart, windowEnd),
  ])

  const failedProviders = new Set<ProviderName>()
  if (monoova.error) failedProviders.add('monoova')
  if (flutterwave.error) failedProviders.add('flutterwave')
  if (budpay.error) failedProviders.add('budpay')

  // Bound the Transfer scan by lookback window. Without this, every
  // historical transfer with a providerRef is scanned nightly and
  // any stale one re-emits `missing_in_statement` indefinitely.
  const transfers = await prisma.transfer.findMany({
    where: {
      updatedAt: { gte: transferLookback },
      OR: [
        { payidProviderRef: { not: null } },
        { payoutProviderRef: { not: null } },
      ],
    },
  })

  const allEntries = [
    ...monoova.entries,
    ...flutterwave.entries,
    ...budpay.entries,
  ]

  const discrepancies = computeDiscrepancies({
    entries: allEntries,
    transfers,
    failedProviders,
  })

  // Idempotency — pre-query ComplianceReport rows written since
  // windowStart with the same dedupe keys. A re-run of the cron in
  // the same window (retry, manual trigger, overlapping invocation)
  // must not emit duplicate SUSPICIOUS rows. A proper unique index
  // is the right long-term fix but needs a migration; this guard is
  // correct for the single-leader cron we have today.
  const existingKeys = new Set<string>()
  try {
    const recent = await prisma.complianceReport.findMany({
      where: {
        type: 'SUSPICIOUS',
        createdAt: { gte: windowStart },
      },
      select: { details: true },
    })
    for (const r of recent) {
      const d = r.details as {
        source?: string
        kind?: string
        provider?: string
        providerRef?: string
      } | null
      if (d?.source === 'provider_reconciliation' && d.kind && d.provider && d.providerRef) {
        existingKeys.add(`${d.kind}:${d.provider}:${d.providerRef}`)
      }
    }
  } catch (err) {
    log('warn', 'provider_reconciliation.dedupe_lookup_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    // Fall through with an empty dedupe set — better to write a
    // duplicate than to drop a signal.
  }

  const breakdown: Record<Discrepancy['kind'], number> = {
    missing_in_ledger: 0,
    missing_in_statement: 0,
    amount_mismatch: 0,
  }

  let writes = 0
  let overflow = false
  for (const d of discrepancies) {
    if (existingKeys.has(dedupeKey(d))) continue
    if (writes >= MAX_DISCREPANCY_WRITES) {
      overflow = true
      break
    }
    breakdown[d.kind] += 1
    writes += 1
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
            occurredAt:
              'occurredAt' in d && !Number.isNaN(d.occurredAt.getTime())
                ? d.occurredAt.toISOString()
                : null,
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
        transferId: 'transferId' in d ? d.transferId : null,
        currency: d.currency,
        amount: 'amount' in d ? d.amount : null,
        expectedAmount: 'expectedAmount' in d ? d.expectedAmount : null,
        actualAmount: 'actualAmount' in d ? d.actualAmount : null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (overflow) {
    try {
      await prisma.complianceReport.create({
        data: {
          type: 'SUSPICIOUS',
          details: {
            source: 'provider_reconciliation',
            kind: 'reconciliation_overflow',
            totalDiscrepancies: discrepancies.length,
            written: writes,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
          },
        },
      })
    } catch (err) {
      log('error', 'provider_reconciliation.overflow_report_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Response error strings are scrubbed: callers get a stable token
  // ('fetch_failed') so unauthenticated probes cannot enumerate our
  // provider integrations via detailed error strings. Full detail
  // lives in the `provider_reconciliation.fetch_failed` log only.
  const outcome: ReconciliationOutcome = {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    providers: [
      { provider: 'monoova', entries: monoova.entries.length, ...(monoova.error ? { error: 'fetch_failed' } : {}) },
      { provider: 'flutterwave', entries: flutterwave.entries.length, ...(flutterwave.error ? { error: 'fetch_failed' } : {}) },
      { provider: 'budpay', entries: budpay.entries.length, ...(budpay.error ? { error: 'fetch_failed' } : {}) },
    ],
    discrepancies: writes,
    discrepancyBreakdown: breakdown,
    ...(overflow ? { overflow: true } : {}),
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
