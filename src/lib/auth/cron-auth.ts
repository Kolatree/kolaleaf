import { timingSafeEqual } from 'crypto'

// Timing-safe bearer-token check for cron endpoints. Matches the pattern
// used by the webhook layer so a single-byte mismatch doesn't leak timing.
// Returns true only when both the header and CRON_SECRET are present and
// equal.
export function authorizeCron(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expected = process.env.CRON_SECRET ?? ''

  if (!token || !expected) return false

  const a = Buffer.from(token, 'utf-8')
  const b = Buffer.from(expected, 'utf-8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
