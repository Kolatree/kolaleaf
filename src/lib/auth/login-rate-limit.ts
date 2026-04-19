const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

interface RateWindow {
  count: number
  windowStart: number
}

const rateLimitMap = new Map<string, RateWindow>()

function buildKeys(identifier: string, ip?: string) {
  const keys = [`identifier:${identifier}`]
  if (ip) keys.push(`ip:${ip}`)
  return keys
}

function getRetryAfterMs(entry: RateWindow, now: number) {
  return Math.max(0, RATE_LIMIT_WINDOW_MS - (now - entry.windowStart))
}

export function checkLoginRateLimit(
  identifier: string,
  ip?: string,
  now = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  let retryAfterMs = 0

  for (const key of buildKeys(identifier, ip)) {
    const entry = rateLimitMap.get(key)
    if (!entry) continue

    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(key)
      continue
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      retryAfterMs = Math.max(retryAfterMs, getRetryAfterMs(entry, now))
    }
  }

  return { allowed: retryAfterMs === 0, retryAfterMs }
}

export function recordLoginFailure(
  identifier: string,
  ip?: string,
  now = Date.now(),
): void {
  for (const key of buildKeys(identifier, ip)) {
    const entry = rateLimitMap.get(key)
    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.set(key, { count: 1, windowStart: now })
      continue
    }

    entry.count += 1
  }
}

export function clearLoginRateLimit(identifier: string, ip?: string): void {
  for (const key of buildKeys(identifier, ip)) {
    rateLimitMap.delete(key)
  }
}

export function __resetLoginRateLimitForTests(): void {
  rateLimitMap.clear()
}
