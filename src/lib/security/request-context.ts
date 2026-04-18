import { createHash } from 'node:crypto'
import { getClientIp } from '@/lib/http/ip'

// Request-derived security context attached to auth and transfer
// events. We persist this inside AuthEvent.metadata so the anomaly
// detector (src/lib/security/anomaly.ts) can diff the current request
// against a user's prior fingerprints without a schema migration.
//
// Fields:
//   ip:                    client IP (validated via getClientIp).
//   country:               ISO 3166-1 alpha-2 code from the edge.
//                          Railway's edge today does not set one; we
//                          still read Cloudflare's `cf-ipcountry` and
//                          Vercel's `x-vercel-ip-country` headers so
//                          migrating to either edge is a no-op.
//   deviceFingerprintHash: sha256 of `user-agent + accept-language +
//                          accept-encoding`. Not cryptographically
//                          strong — all three headers are trivially
//                          spoofed — but it gives the anomaly detector
//                          a stable identifier to diff against prior
//                          sessions. The "basic at launch" bar in
//                          CLAUDE.md.
//   userAgent:             raw UA string for compliance-ops triage.
//
// All fields are optional at the type level — the getClientIp path
// already tolerates a missing or malformed XFF header, and we should
// persist what we have rather than fail the request.

export interface RequestContext {
  ip?: string
  country?: string
  deviceFingerprintHash?: string
  userAgent?: string
}

// Upper-case ISO-alpha-2 country code. The edges we support already
// normalise to upper-case, but we re-normalise so a future edge that
// emits lower-case doesn't produce duplicate `{AU, au}` entries in the
// fingerprint history.
function readCountry(request: Request): string | undefined {
  const cf = request.headers.get('cf-ipcountry')
  const vercel = request.headers.get('x-vercel-ip-country')
  const raw = cf ?? vercel
  if (!raw) return undefined
  const trimmed = raw.trim()
  // Cloudflare uses 'XX' for unknown and 'T1' for Tor exit nodes.
  // Both are legitimate signals the anomaly detector should see, so
  // we keep them; only empty strings are treated as absent.
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

export function extractRequestContext(request: Request): RequestContext {
  return {
    ip: getClientIp(request),
    country: readCountry(request),
    deviceFingerprintHash: hashDeviceFingerprint(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
  }
}
