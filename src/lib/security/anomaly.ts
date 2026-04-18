import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'
import type { RequestContext } from './request-context'

// Security anomaly detector. Reads the user's recent AuthEvent history
// to build a set of known (country, deviceFingerprintHash) pairs, then
// compares the current RequestContext against those. Divergence emits
// a SUSPICIOUS ComplianceReport into the same sink used by the
// velocity / AUSTRAC / reconciliation paths.
//
// Design notes:
// - History window: the last AUTH_HISTORY_LOOKBACK_DAYS of events.
//   Beyond that, a two-year-old login fingerprint shouldn't poison
//   the baseline. AUSTRAC still has the full chain via AuthEvent
//   rows themselves; this only bounds the diff input.
// - Never blocks the request: the caller awaits at most a single
//   INSERT into ComplianceReport; if that fails we swallow the error
//   and log it. An unreachable DB cannot break login or a transfer.
// - Never emits noise on first-ever event: an empty history means
//   no baseline to diverge from. We just write an ESTABLISHED marker
//   so subsequent calls have something to diff against. (That marker
//   is the AuthEvent itself, already written upstream — we don't emit
//   a ComplianceReport.)
// - All details go into ComplianceReport.details as a typed payload
//   so the admin review UI can render without type-guessing.

const AUTH_HISTORY_LOOKBACK_DAYS = 90
const HISTORY_EVENT_LIMIT = 50

export type AnomalyKind =
  | 'new_country'
  | 'new_device'
  | 'new_country_and_device'

// Metadata shape the caller persists into AuthEvent.metadata so we
// can recover it here. Keys match the RequestContext field names.
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

function classify(
  current: RequestContext,
  seen: { countries: Set<string>; devices: Set<string> },
): AnomalyKind | null {
  // First-event case: empty history gives us no baseline so there is
  // nothing to diverge from. Caller's AuthEvent is the baseline for
  // next time.
  if (seen.countries.size === 0 && seen.devices.size === 0) return null

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
}

// Main entry point. Call AFTER the upstream AuthEvent has been
// persisted — otherwise the current fingerprint is also included in
// the history query and every login looks benign.
//
// Never throws: a broken compliance sink must not fail login or a
// transfer create. The caller treats this as fire-and-forget.
export async function recordSecurityAnomalyCheck(
  params: RecordAnomalyParams,
): Promise<void> {
  try {
    const since = new Date(
      Date.now() - AUTH_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
    const events = await prisma.authEvent.findMany({
      where: {
        userId: params.userId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_EVENT_LIMIT,
      select: { metadata: true },
    })

    const seen = collectSeen(events)
    const kind = classify(params.context, seen)
    if (!kind) return

    await prisma.complianceReport.create({
      data: {
        type: 'SUSPICIOUS',
        userId: params.userId,
        transferId: params.transferId ?? null,
        details: {
          source: 'security_anomaly',
          kind,
          event: params.event,
          ip: params.context.ip ?? null,
          country: params.context.country ?? null,
          deviceFingerprintHash: params.context.deviceFingerprintHash ?? null,
          userAgent: params.context.userAgent ?? null,
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
  } catch (err) {
    // Swallow: compliance-sink failure cannot break the auth or
    // transfer path. The raw event is still in AuthEvent, and a
    // subsequent cron (or manual triage) can reconstruct.
    log('error', 'security.anomaly.check_failed', {
      userId: params.userId,
      transferId: params.transferId,
      event: params.event,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Exported for unit testing the pure classification layer without
// spinning up Prisma.
export const __test = { collectSeen, classify }
