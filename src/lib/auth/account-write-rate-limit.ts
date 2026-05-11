// Per-user rate limit for low-volume authenticated account writes
// (PATCH /account/me today; expand here as new write surfaces land).
//
// Why this exists separately from `login-rate-limit.ts`:
//   - Login is identifier+IP scoped; account writes are userId-only
//     (the caller is already authenticated).
//   - Login windows are minutes (15) with low caps (5); account writes
//     are bursty-but-bounded (20/day) — a different shape.
//
// Storage strategy (mirrors `login-rate-limit.ts`):
//   - Redis when REDIS_URL is set, with INCR + EXPIRE pipelined so a
//     crash between calls cannot strand a key without a TTL.
//   - In-process fallback otherwise so dev / tests have no extra
//     infrastructure dependency.
//
// Cap: 20 writes per 24h per userId. The /account/me PATCH is a
// human-driven address/displayName edit — a real user does this <1x
// per session, so 20 leaves comfortable headroom for retries while
// still capping abuse from a stolen session.
//
// ADV2-2: health-aware reconnect. Once the connection emits an
// `error`, we set `redisFailed = true` and record `redisFailedAt`. On
// each subsequent call, if at least `RECONNECT_BACKOFF_MS` has passed,
// we attempt a `PING` against the existing client. On success we clear
// the failed flag (subsequent calls go back to Redis); on failure we
// roll the timestamp forward. Without this, a multi-instance deploy
// that loses Redis briefly silently multiplies the per-user cap by N
// for the rest of the process lifetime.

import IORedis from "ioredis";

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_S = 24 * 60 * 60; // 24 hours in seconds
const KEY_PREFIX = "ratelimit:account-write:";
/** Minimum gap between PING attempts after a Redis failure. Avoids
 *  hammering Redis during a sustained outage. */
const RECONNECT_BACKOFF_MS = 30_000;

let redis: IORedis | null = null;
let redisFailed = false;
let redisFailedAt = 0;

/** Visible-for-tests: probe the current Redis client with a `PING`.
 *  When PING succeeds, clears the failure flag so subsequent calls
 *  fall back to the live client; otherwise updates the back-off
 *  timestamp. Internal helper — exported only so tests can drive it
 *  deterministically against a mocked client. */
export async function __probeRedisHealth(now = Date.now()): Promise<boolean> {
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
  if (redisFailed) {
    // ADV2-2: only retry once the back-off window has elapsed. Falls
    // back to in-process until the caller-side probe (below) clears
    // the flag.
    return null;
  }
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
      redisFailed = true;
      redisFailedAt = Date.now();
      // Note: we DO NOT null `redis` here. Keeping the client lets
      // `__probeRedisHealth` PING it once the back-off elapses; if
      // ioredis recovers internally the PING returns PONG and we
      // resume serving from Redis without rebuilding the client (and
      // without tearing down its event listeners).
    });
    return redis;
  } catch {
    redisFailed = true;
    redisFailedAt = now;
    return null;
  }
}

/**
 * Internal: if Redis was previously marked failed and the back-off
 * window has elapsed, attempt a single PING. Mutates the
 * module-level flags. Returns the (possibly recovered) live client
 * or `null` if still failed.
 */
async function attemptRedisRecovery(now: number): Promise<IORedis | null> {
  if (!redisFailed) return redis;
  if (now - redisFailedAt < RECONNECT_BACKOFF_MS) return null;
  const recovered = await __probeRedisHealth(now);
  return recovered ? redis : null;
}

interface RateWindow {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateWindow>();

function buildKey(scope: string, userId: string): string {
  return `${KEY_PREFIX}${scope}:${userId}`;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

async function checkAndIncrementRedis(
  key: string,
  r: IORedis,
): Promise<RateLimitResult> {
  // Atomic INCR + EXPIRE so a crash between them cannot leave the
  // key TTL-less (permanent lockout).
  const pipeline = r.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, RATE_LIMIT_WINDOW_S);
  const results = await pipeline.exec();
  const count = (results?.[0]?.[1] as number) ?? 0;
  if (count > RATE_LIMIT_MAX) {
    const ttl = await r.ttl(key);
    const retryAfterMs = ttl > 0 ? ttl * 1000 : RATE_LIMIT_WINDOW_S * 1000;
    return { allowed: false, retryAfterMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

function checkAndIncrementInProcess(key: string, now: number): RateLimitResult {
  const windowMs = RATE_LIMIT_WINDOW_S * 1000;
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterMs: windowMs - (now - entry.windowStart),
    };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Atomically increment-and-check the per-user counter for a given
 *  write scope. Returns `{ allowed: false, retryAfterMs }` once the
 *  user crosses the cap; the caller emits a 429 with the hint. */
export async function checkAccountWriteRateLimit(
  scope: string,
  userId: string,
  now = Date.now(),
): Promise<RateLimitResult> {
  const key = buildKey(scope, userId);
  // ADV2-2: try recovery before each call so a transient Redis blip
  // doesn't permanently downgrade us to the in-process fallback.
  let r = await attemptRedisRecovery(now);
  if (!r) r = getRedis(now);
  if (r) return checkAndIncrementRedis(key, r);
  return checkAndIncrementInProcess(key, now);
}

export function __resetAccountWriteRateLimitForTests(): void {
  rateLimitMap.clear();
  redisFailed = false;
  redisFailedAt = 0;
  redis = null;
}

/** Visible-for-tests: directly set the cached Redis client (used by
 *  the ADV2-2 reconnect test to inject a controllable mock). */
export function __setRedisClientForTests(client: IORedis | null): void {
  redis = client;
  redisFailed = false;
  redisFailedAt = 0;
}

/** Visible-for-tests: mark Redis as failed at a given timestamp so
 *  the reconnect-back-off test can exercise the recovery path. */
export function __markRedisFailedForTests(at: number): void {
  redisFailed = true;
  redisFailedAt = at;
}
