import IORedis from "ioredis";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_S = 15 * 60; // 15 minutes in seconds
/** ADV2-2: minimum gap between Redis health-probe attempts after a
 *  failure. Avoids hammering Redis during a sustained outage. */
const RECONNECT_BACKOFF_MS = 30_000;

// Lazy singleton Redis connection. Reuses the same REDIS_URL that BullMQ
// uses (set in production/staging). Falls back to an in-process Map when
// Redis is unavailable (dev/tests) so the module never hard-fails.
//
// ADV2-2: once `redisFailed` is set, a `PING`-based recovery probe runs
// at most every `RECONNECT_BACKOFF_MS`. Without this, a brief Redis
// outage on a multi-instance deploy would silently downgrade login
// rate-limiting to in-process for the rest of the process lifetime
// (multiplying the cap by N instances).
let redis: IORedis | null = null;
let redisFailed = false;
let redisFailedAt = 0;

/** Visible-for-tests: probe the current Redis client with a PING. */
export async function __probeLoginRedisHealth(
  now = Date.now(),
): Promise<boolean> {
  if (!redis) return false;
  try {
    const reply = await redis.ping();
    if (reply === "PONG") {
      redisFailed = false;
      redisFailedAt = 0;
      return true;
    }
    redisFailedAt = now;
    return false;
  } catch {
    redisFailedAt = now;
    return false;
  }
}

function getRedis(now = Date.now()): IORedis | null {
  if (redisFailed) return null;
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url || url.trim() === "") {
    redisFailed = true;
    redisFailedAt = now;
    return null;
  }
  try {
    redis = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    redis.on("error", () => {
      // Swallow connection errors — fall back to in-process map silently.
      // Note: keep the client cached so __probeLoginRedisHealth can
      // PING it once the back-off elapses (ioredis recovers internally;
      // the PING surfaces that without rebuilding the client).
      redisFailed = true;
      redisFailedAt = Date.now();
    });
    return redis;
  } catch {
    redisFailed = true;
    redisFailedAt = now;
    return null;
  }
}

/** ADV2-2: if Redis was previously marked failed and the back-off has
 *  elapsed, probe it. Returns the live client or null if still down. */
async function attemptRedisRecovery(now: number): Promise<IORedis | null> {
  if (!redisFailed) return redis;
  if (now - redisFailedAt < RECONNECT_BACKOFF_MS) return null;
  const recovered = await __probeLoginRedisHealth(now);
  return recovered ? redis : null;
}

// In-process fallback (dev / tests)

interface RateWindow {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateWindow>();

// Key helpers

const KEY_PREFIX = "ratelimit:login:";

function buildKeys(identifier: string, ip?: string) {
  const keys = [`${KEY_PREFIX}identifier:${identifier}`];
  if (ip) keys.push(`${KEY_PREFIX}ip:${ip}`);
  return keys;
}

// Redis-backed implementation

async function checkRedis(
  keys: string[],
  r: IORedis,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  let retryAfterMs = 0;
  for (const key of keys) {
    const count = await r.get(key);
    if (count !== null && parseInt(count, 10) >= RATE_LIMIT_MAX) {
      const ttl = await r.ttl(key);
      if (ttl > 0) {
        retryAfterMs = Math.max(retryAfterMs, ttl * 1000);
      }
    }
  }
  return { allowed: retryAfterMs === 0, retryAfterMs };
}

async function recordRedis(keys: string[], r: IORedis): Promise<void> {
  for (const key of keys) {
    // Pipeline INCR+EXPIRE atomically so a crash between them
    // cannot leave a key without a TTL (permanent lockout).
    const pipeline = r.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, RATE_LIMIT_WINDOW_S);
    await pipeline.exec();
  }
}

async function clearRedis(keys: string[], r: IORedis): Promise<void> {
  if (keys.length > 0) {
    await r.del(...keys);
  }
}

// In-process fallback implementation

function checkInProcess(
  keys: string[],
  now: number,
): { allowed: boolean; retryAfterMs: number } {
  let retryAfterMs = 0;
  const windowMs = RATE_LIMIT_WINDOW_S * 1000;
  for (const key of keys) {
    const entry = rateLimitMap.get(key);
    if (!entry) continue;
    if (now - entry.windowStart >= windowMs) {
      rateLimitMap.delete(key);
      continue;
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      retryAfterMs = Math.max(
        retryAfterMs,
        windowMs - (now - entry.windowStart),
      );
    }
  }
  return { allowed: retryAfterMs === 0, retryAfterMs };
}

function recordInProcess(keys: string[], now: number): void {
  const windowMs = RATE_LIMIT_WINDOW_S * 1000;
  for (const key of keys) {
    const entry = rateLimitMap.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      rateLimitMap.set(key, { count: 1, windowStart: now });
      continue;
    }
    entry.count += 1;
  }
}

function clearInProcess(keys: string[]): void {
  for (const key of keys) {
    rateLimitMap.delete(key);
  }
}

// Public API

export async function checkLoginRateLimit(
  identifier: string,
  ip?: string,
  now = Date.now(),
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const keys = buildKeys(identifier, ip);
  let r = await attemptRedisRecovery(now);
  if (!r) r = getRedis(now);
  if (r) return checkRedis(keys, r);
  return checkInProcess(keys, now);
}

export async function recordLoginFailure(
  identifier: string,
  ip?: string,
  now = Date.now(),
): Promise<void> {
  const keys = buildKeys(identifier, ip);
  let r = await attemptRedisRecovery(now);
  if (!r) r = getRedis(now);
  if (r) return recordRedis(keys, r);
  recordInProcess(keys, now);
}

export async function clearLoginRateLimit(
  identifier: string,
  ip?: string,
): Promise<void> {
  const keys = buildKeys(identifier, ip);
  let r = await attemptRedisRecovery(Date.now());
  if (!r) r = getRedis();
  if (r) return clearRedis(keys, r);
  clearInProcess(keys);
}

export function __resetLoginRateLimitForTests(): void {
  rateLimitMap.clear();
  redisFailed = false;
  redisFailedAt = 0;
  redis = null;
}

/** Visible-for-tests: directly set the cached Redis client. */
export function __setLoginRedisClientForTests(client: IORedis | null): void {
  redis = client;
  redisFailed = false;
  redisFailedAt = 0;
}

/** Visible-for-tests: mark Redis as failed at a given timestamp. */
export function __markLoginRedisFailedForTests(at: number): void {
  redisFailed = true;
  redisFailedAt = at;
}
