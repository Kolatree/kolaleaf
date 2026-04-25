import IORedis from 'ioredis'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_S = 15 * 60 // 15 minutes in seconds

// Lazy singleton Redis connection. Reuses the same REDIS_URL that BullMQ
// uses (set in production/staging). Falls back to an in-process Map when
// Redis is unavailable (dev/tests) so the module never hard-fails.
let redis: IORedis | null = null
let redisFailed = false

function getRedis(): IORedis | null {
  if (redisFailed) return null
  if (redis) return redis
  const url = process.env.REDIS_URL
  if (!url || url.trim() === '') {
    redisFailed = true
    return null
  }
  try {
    redis = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true })
    redis.on('error', () => {
      // Swallow connection errors — fall back to in-process map silently.
      redisFailed = true
      redis = null
    })
    return redis
  } catch {
    redisFailed = true
    return null
  }
}

// ─── In-process fallback (dev / tests) ──────────────────────────────

interface RateWindow {
  count: number
  windowStart: number
}

const rateLimitMap = new Map<string, RateWindow>()

// ─── Key helpers ────────────────────────────────────────────────────

const KEY_PREFIX = 'ratelimit:login:'

function buildKeys(identifier: string, ip?: string) {
  const keys = [`${KEY_PREFIX}identifier:${identifier}`]
  if (ip) keys.push(`${KEY_PREFIX}ip:${ip}`)
  return keys
}

// ─── Redis-backed implementation ────────────────────────────────────

async function checkRedis(keys: string[], r: IORedis): Promise<{ allowed: boolean; retryAfterMs: number }> {
  let retryAfterMs = 0
  for (const key of keys) {
    const count = await r.get(key)
    if (count !== null && parseInt(count, 10) >= RATE_LIMIT_MAX) {
      const ttl = await r.ttl(key)
      if (ttl > 0) {
        retryAfterMs = Math.max(retryAfterMs, ttl * 1000)
      }
    }
  }
  return { allowed: retryAfterMs === 0, retryAfterMs }
}

async function recordRedis(keys: string[], r: IORedis): Promise<void> {
  for (const key of keys) {
    // Pipeline INCR+EXPIRE atomically so a crash between them
    // cannot leave a key without a TTL (permanent lockout).
    const pipeline = r.pipeline()
    pipeline.incr(key)
    pipeline.expire(key, RATE_LIMIT_WINDOW_S)
    await pipeline.exec()
  }
}

async function clearRedis(keys: string[], r: IORedis): Promise<void> {
  if (keys.length > 0) {
    await r.del(...keys)
  }
}

// ─── In-process fallback implementation ─────────────────────────────

function checkInProcess(keys: string[], now: number): { allowed: boolean; retryAfterMs: number } {
  let retryAfterMs = 0
  const windowMs = RATE_LIMIT_WINDOW_S * 1000
  for (const key of keys) {
    const entry = rateLimitMap.get(key)
    if (!entry) continue
    if (now - entry.windowStart >= windowMs) {
      rateLimitMap.delete(key)
      continue
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      retryAfterMs = Math.max(retryAfterMs, windowMs - (now - entry.windowStart))
    }
  }
  return { allowed: retryAfterMs === 0, retryAfterMs }
}

function recordInProcess(keys: string[], now: number): void {
  const windowMs = RATE_LIMIT_WINDOW_S * 1000
  for (const key of keys) {
    const entry = rateLimitMap.get(key)
    if (!entry || now - entry.windowStart >= windowMs) {
      rateLimitMap.set(key, { count: 1, windowStart: now })
      continue
    }
    entry.count += 1
  }
}

function clearInProcess(keys: string[]): void {
  for (const key of keys) {
    rateLimitMap.delete(key)
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export async function checkLoginRateLimit(
  identifier: string,
  ip?: string,
  now = Date.now(),
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const keys = buildKeys(identifier, ip)
  const r = getRedis()
  if (r) return checkRedis(keys, r)
  return checkInProcess(keys, now)
}

export async function recordLoginFailure(
  identifier: string,
  ip?: string,
  now = Date.now(),
): Promise<void> {
  const keys = buildKeys(identifier, ip)
  const r = getRedis()
  if (r) return recordRedis(keys, r)
  recordInProcess(keys, now)
}

export async function clearLoginRateLimit(identifier: string, ip?: string): Promise<void> {
  const keys = buildKeys(identifier, ip)
  const r = getRedis()
  if (r) return clearRedis(keys, r)
  clearInProcess(keys)
}

export function __resetLoginRateLimitForTests(): void {
  rateLimitMap.clear()
}
