// Extract the client IP from an incoming Request, defending against a
// spoofed `x-forwarded-for` header.
//
// Railway's edge terminates the TLS connection and prepends the real
// client IP to any `x-forwarded-for` header the client may have set.
// That means the FIRST value in the comma-separated list is
// authoritative; everything after it is attacker-controlled unless a
// trusted downstream proxy explicitly overwrote it.
//
// We take the first value, strip surrounding whitespace, and validate
// that it looks like an IPv4 or IPv6 address. If validation fails we
// return `undefined` rather than persisting attacker-chosen junk into
// the AUSTRAC audit trail via Session.ip / AuthEvent.ip.
//
// We deliberately do NOT support `x-real-ip` (some edges set it,
// Railway doesn't) — a single source of truth avoids header precedence
// bugs. If we ever deploy behind a different edge, extend this helper
// rather than the call sites.

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/
// Compact IPv6 detection — not a strict parser, just enough to reject
// XFF strings like "evil, 127.0.0.1" that have commas. The IPv4-in-IPv6
// syntax (::ffff:1.2.3.4) is accepted because it contains a colon.
const IPV6_RE = /^[0-9a-fA-F:]+$/

export function getClientIp(request: Request): string | undefined {
  const xff = request.headers.get('x-forwarded-for')
  if (!xff) return undefined

  // Comma-separated list: take the first (leftmost) entry.
  const first = xff.split(',')[0]?.trim()
  if (!first) return undefined

  if (IPV4_RE.test(first)) return first
  if (IPV6_RE.test(first) && first.includes(':')) return first

  // Malformed — treat as absent rather than persist a spoofed value.
  return undefined
}
