import { createHash } from 'node:crypto'
import { getClientIp } from '@/lib/http/ip'

// Request-derived security context attached to auth and transfer
// events. We persist this inside AuthEvent.metadata so the anomaly
// detector (src/lib/security/anomaly.ts) can diff the current request
// against a user's prior fingerprints without a schema migration.
//
// PII handling (Wave 1 review finding):
// - `ipTruncated` is the IPv4 /24 or IPv6 /48 prefix — compliance gets
//   the region-level signal without AUSTRAC-grade retention of the
//   full address.
// - `userAgent` is sanitized (control-chars stripped, capped at
//   MAX_UA_LENGTH) to defuse log-injection, DB bloat, and forged
//   tracing.
// - `deviceFingerprintHash` is the only per-device identifier we
//   persist. The raw headers are never stored.
//
// Trust model:
// - `country` is only read when EDGE_PROVIDER is set to a value that
//   names a real edge that injects + sanitizes the header ('cloudflare'
//   or 'vercel'). Any other deploy (Railway direct, local dev) leaves
//   country undefined — the alternative is accepting attacker-supplied
//   `cf-ipcountry: AU` headers and degrading new_country to a no-op.
//
// Fields:
//   ip:                    full client IP (validated). Used for the
//                          inline AuthEvent.ip column, which the
//                          anomaly detector never reads — ops / fraud
//                          triage does. Not persisted in
//                          ComplianceReport.details.
//   ipTruncated:           /24 (IPv4) or /48 (IPv6) prefix. Safe to
//                          persist in compliance artefacts.
//   country:               ISO 3166-1 alpha-2 code, trusted-edge only.
//   deviceFingerprintHash: sha256 of (user-agent + accept-language +
//                          accept-encoding). Not cryptographically
//                          strong — matches "basic at launch" per
//                          CLAUDE.md.
//   userAgent:             sanitized UA for compliance-ops triage.

const MAX_UA_LENGTH = 512
const TRUSTED_EDGE_PROVIDERS = new Set(['cloudflare', 'vercel'])
// Strip ASCII control chars + DEL. Keeps the UA printable-ASCII +
// UTF-8 with no embedded newlines or ANSI escapes.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/g

export interface RequestContext {
  ip?: string
  ipTruncated?: string
  country?: string
  deviceFingerprintHash?: string
  userAgent?: string
}

function readCountry(request: Request): string | undefined {
  const edge = process.env.EDGE_PROVIDER?.toLowerCase()
  if (!edge || !TRUSTED_EDGE_PROVIDERS.has(edge)) return undefined

  const cf = request.headers.get('cf-ipcountry')
  const vercel = request.headers.get('x-vercel-ip-country')
  const raw = cf ?? vercel
  if (!raw) return undefined
  const trimmed = raw.trim()
  // Cloudflare uses 'XX' for unknown and 'T1' for Tor exit nodes.
  // Both are legitimate signals — keep them; only empty strings are
  // treated as absent.
  if (!trimmed) return undefined
  return trimmed.toUpperCase()
}

function hashDeviceFingerprint(request: Request): string | undefined {
  const ua = request.headers.get('user-agent')
  const lang = request.headers.get('accept-language')
  const enc = request.headers.get('accept-encoding')
  if (!ua && !lang && !enc) return undefined
  const input = `${ua ?? ''}|${lang ?? ''}|${enc ?? ''}`
  return createHash('sha256').update(input).digest('hex')
}

// Exported for direct unit testing — the undici runtime validates
// header values at Request construction, which makes control-char
// paths unreachable from a test that tries to inject them via
// `new Request({ headers: ... })`.
export function sanitizeUserAgent(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const cleaned = raw.replace(CONTROL_CHAR_RE, '').trim()
  if (cleaned.length === 0) return undefined
  return cleaned.length > MAX_UA_LENGTH
    ? cleaned.slice(0, MAX_UA_LENGTH)
    : cleaned
}

// Truncate an IPv4 to /24 or an IPv6 to /48. Returns undefined for
// malformed input (shouldn't happen — getClientIp validates first).
export function truncateIp(ip: string): string | undefined {
  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length !== 4) return undefined
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`
  }
  if (ip.includes(':')) {
    const parts = ip.split(':')
    // Take the first 3 groups (48 bits) and zero the rest. Handles
    // shorthand like '::1' by padding empty groups back in.
    const nonEmpty = parts.slice(0, 3)
    return `${nonEmpty.join(':')}::/48`
  }
  return undefined
}

export function extractRequestContext(request: Request): RequestContext {
  const ip = getClientIp(request)
  return {
    ip,
    ipTruncated: ip ? truncateIp(ip) : undefined,
    country: readCountry(request),
    deviceFingerprintHash: hashDeviceFingerprint(request),
    userAgent: sanitizeUserAgent(request.headers.get('user-agent')),
  }
}
