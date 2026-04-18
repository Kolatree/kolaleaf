import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'
import type { RequestContext } from './request-context'

// Security anomaly detector. Reads the user's recent AuthEvent history
// to build a set of known (country, deviceFingerprintHash) pairs, then
// compares the current RequestContext against those. Divergence emits
// a SUSPICIOUS ComplianceReport into the same sink used by the
// velocity / AUSTRAC / reconciliation paths.
//
// Design notes (reflecting Wave 1 hardening):
// - History query uses `createdAt: { lt: observedAt }` so the row
//   that triggered this check — which the caller just persisted —
//   is NEVER part of its own baseline. Race-proof: the observedAt
//   timestamp is captured before the AuthEvent write.
// - kyc_country_mismatch is a dedicated signal independent of the
//   behavioural baseline. Step 32's AUSTRAC intent is "flag transfers
//   from a different country than KYC." We compare current.country
//   against user.country (the KYC-registered address) separately.
// - Dedupe: we skip writing a SUSPICIOUS report for the same
//   (userId, kind, country, deviceFingerprintHash) already written
//   within DEDUPE_WINDOW_HOURS. Prevents the compliance-ops flood
//   when a user logs in from 5 coffee shops in one day.
// - Never blocks the request: call sites `.catch()` the promise so
//   even a synchronous pre-try throw cannot crash the worker.

export const AUTH_HISTORY_LOOKBACK_DAYS = 90
export const HISTORY_EVENT_LIMIT = 50
export const DEDUPE_WINDOW_HOURS = 24

export type AnomalyKind =
  | 'new_country'
  | 'new_device'
  | 'new_country_and_device'
  | 'kyc_country_mismatch'

// Metadata shape the caller persists into AuthEvent.metadata.
interface AuthEventMetadataWithContext {
  country?: string
  deviceFingerprintHash?: string
  [key: string]: unknown
}

function collectSeen(
  events: { metadata: unknown }[],
): { countries: Set<string>; devices: Set<string> } {
  const countries = new Set<string>()
  const devices = new Set<string>()
  for (const e of events) {
    const m = e.metadata as AuthEventMetadataWithContext | null | undefined
    if (!m || typeof m !== 'object') continue
    if (typeof m.country === 'string') countries.add(m.country)
    if (typeof m.deviceFingerprintHash === 'string') {
      devices.add(m.deviceFingerprintHash)
    }
  }
  return { countries, devices }
}

function classifyBehavioural(
  current: RequestContext,
  seen: { countries: Set<string>; devices: Set<string> },
): AnomalyKind | null {
  // First-event case: no baseline yet, nothing to diverge from.
  if (seen.countries.size === 0 && seen.devices.size === 0) return null

  // A missing current dimension cannot be "different" — treat as
  // known so a Railway deploy with no country header doesn't flag
  // every login.
  const countryKnown =
    !current.country || seen.countries.size === 0
      ? true
      : seen.countries.has(current.country)
  const deviceKnown =
    !current.deviceFingerprintHash || seen.devices.size === 0
      ? true
      : seen.devices.has(current.deviceFingerprintHash)

  if (!countryKnown && !deviceKnown) return 'new_country_and_device'
  if (!countryKnown) return 'new_country'
  if (!deviceKnown) return 'new_device'
  return null
}

interface RecordAnomalyParams {
  userId: string
  context: RequestContext
  event: string
  transferId?: string
  // Timestamp captured BEFORE the caller writes its own AuthEvent.
  // The history query filters events strictly earlier than this so
  // the just-written row is never part of the baseline. If omitted,
  // defaults to `new Date()` for callers that don't write an event
  // at all (e.g. transfer create, which writes to Transfer not
  // AuthEvent).
  observedAt?: Date
}

interface ReportDedupeKey {
  kind: AnomalyKind
  country: string | null
  deviceFingerprintHash: string | null
}

function dedupeKey(p: RecordAnomalyParams, kind: AnomalyKind): ReportDedupeKey {
  return {
    kind,
    country: p.context.country ?? null,
    deviceFingerprintHash: p.context.deviceFingerprintHash ?? null,
  }
}

async function isDuplicateRecent(
  userId: string,
  key: ReportDedupeKey,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000)
  const recent = await prisma.complianceReport.findMany({
    where: {
      type: 'SUSPICIOUS',
      userId,
      createdAt: { gte: since },
    },
    select: { details: true },
  })
  for (const r of recent) {
    const d = r.details as {
      source?: string
      kind?: string
      country?: string | null
      deviceFingerprintHash?: string | null
    } | null
    if (!d || d.source !== 'security_anomaly') continue
    if (d.kind !== key.kind) continue
    if ((d.country ?? null) !== key.country) continue
    if ((d.deviceFingerprintHash ?? null) !== key.deviceFingerprintHash) continue
    return true
  }
  return false
}

// Internal main body. Wrapped by the exported recordSecurityAnomalyCheck
// so all call sites get unified error handling.
async function runCheck(params: RecordAnomalyParams): Promise<void> {
  const observedAt = params.observedAt ?? new Date()
  const since = new Date(
    observedAt.getTime() - AUTH_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  )

  const events = await prisma.authEvent.findMany({
    where: {
      userId: params.userId,
      createdAt: { gte: since, lt: observedAt },
    },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_EVENT_LIMIT,
    select: { metadata: true },
  })
  const seen = collectSeen(events)

  const behaviouralKind = classifyBehavioural(params.context, seen)

  // KYC-country mismatch check runs independently of behavioural
  // baseline. AUSTRAC wants "transfer from a country different from
  // the user's registered address" — not "country we've seen before."
  let kycMismatch: AnomalyKind | null = null
  if (params.context.country) {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { country: true },
    })
    if (user?.country && user.country !== params.context.country) {
      kycMismatch = 'kyc_country_mismatch'
    }
  }

  const kinds: AnomalyKind[] = []
  if (behaviouralKind) kinds.push(behaviouralKind)
  if (kycMismatch) kinds.push(kycMismatch)
  if (kinds.length === 0) return

  for (const kind of kinds) {
    const key = dedupeKey(params, kind)
    if (await isDuplicateRecent(params.userId, key)) {
      log('info', 'security.anomaly.deduped', {
        userId: params.userId,
        kind,
        event: params.event,
      })
      continue
    }

    await prisma.complianceReport.create({
      data: {
        type: 'SUSPICIOUS',
        userId: params.userId,
        transferId: params.transferId ?? null,
        details: {
          source: 'security_anomaly',
          kind,
          event: params.event,
          ipTruncated: params.context.ipTruncated ?? null,
          country: params.context.country ?? null,
          deviceFingerprintHash: params.context.deviceFingerprintHash ?? null,
          // userAgent intentionally NOT persisted into compliance
          // details — raw UA is PII and CLAUDE.md mandates AES-256
          // at rest. Full UA stays in AuthEvent for ops triage;
          // compliance gets only the hash.
          knownCountries: Array.from(seen.countries).sort(),
          knownDeviceCount: seen.devices.size,
          detectedAt: new Date().toISOString(),
        },
      },
    })

    log('info', 'security.anomaly.detected', {
      userId: params.userId,
      transferId: params.transferId,
      kind,
      event: params.event,
    })
  }
}

// Main entry point. Callers write their upstream AuthEvent FIRST,
// then call this with `observedAt` set to a timestamp captured
// BEFORE that write. The history query filter `createdAt: { lt: observedAt }`
// then guarantees the just-written row is not part of its own
// baseline. For callers that don't write an AuthEvent (transfer
// create, which writes Transfer), `observedAt` can be omitted.
//
// Never throws: compliance-sink failure cannot break login or
// transfer create. Callers MUST still .catch() the promise as a
// belt-and-braces against synchronous pre-try throws.
export async function recordSecurityAnomalyCheck(
  params: RecordAnomalyParams,
): Promise<void> {
  try {
    await runCheck(params)
  } catch (err) {
    log('error', 'security.anomaly.check_failed', {
      userId: params.userId,
      transferId: params.transferId,
      event: params.event,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Exported for unit testing the pure layers without Prisma.
export const __test = { collectSeen, classifyBehavioural }
