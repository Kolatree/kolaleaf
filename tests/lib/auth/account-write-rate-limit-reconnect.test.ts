// ADV2-2: health-aware Redis reconnect for the account-write
// rate limiter.
//
// Without this, once the cached Redis client emits a single `error`
// event we silently downgrade to the in-process Map for the rest of
// the process lifetime. On a multi-instance Railway deploy with
// intermittent Redis blips that quietly multiplies the per-user cap
// by the number of instances. The reconnect path probes the cached
// client with a `PING` after a back-off and resumes serving from
// Redis when it returns `PONG`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetAccountWriteRateLimitForTests,
  __setRedisClientForTests,
  __markRedisFailedForTests,
  __probeRedisHealth,
  checkAccountWriteRateLimit,
} from "@/lib/auth/account-write-rate-limit";

interface MockRedis {
  ping: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
}

function makeMockRedis(): MockRedis {
  // Pipeline returns an object with chainable incr/expire/exec; exec
  // resolves to `[[null, count], [null, 1]]` so the limiter sees a
  // count of 1 (allowed).
  const exec = vi.fn().mockResolvedValue([
    [null, 1],
    [null, 1],
  ]);
  const pipeline = vi.fn().mockReturnValue({
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec,
  });
  return {
    ping: vi.fn().mockResolvedValue("PONG"),
    pipeline,
    ttl: vi.fn().mockResolvedValue(60),
  };
}

describe("account-write rate limiter — ADV2-2 health-aware reconnect", () => {
  beforeEach(() => {
    __resetAccountWriteRateLimitForTests();
  });

  afterEach(() => {
    __resetAccountWriteRateLimitForTests();
    vi.useRealTimers();
  });

  it("after Redis failure, probes once back-off elapses and resumes Redis on PONG", async () => {
    const fakeRedis = makeMockRedis();
    // Inject the mocked client so the module thinks Redis is live.
    __setRedisClientForTests(fakeRedis as unknown as never);

    // (1) Mark Redis as failed at t=0.
    __markRedisFailedForTests(0);

    // (2) Within the 30s back-off window: no PING attempt yet — fall
    //     back to in-process. The pipeline must NOT be called.
    const within = await checkAccountWriteRateLimit("account-me", "u1", 1_000);
    expect(within.allowed).toBe(true);
    expect(fakeRedis.ping).not.toHaveBeenCalled();
    expect(fakeRedis.pipeline).not.toHaveBeenCalled();

    // (3) After the 30s back-off: probe runs, PING succeeds, the
    //     limiter reverts to using Redis on subsequent calls.
    const after = await checkAccountWriteRateLimit("account-me", "u1", 31_001);
    expect(after.allowed).toBe(true);
    expect(fakeRedis.ping).toHaveBeenCalledTimes(1);
    expect(fakeRedis.pipeline).toHaveBeenCalledTimes(1);
  });

  it("if PING fails, stays on the in-process fallback and rolls the back-off forward", async () => {
    const fakeRedis = makeMockRedis();
    fakeRedis.ping.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    __setRedisClientForTests(fakeRedis as unknown as never);
    __markRedisFailedForTests(0);

    // After 30s, PING is attempted but rejects. Limiter must stay on
    // in-process (no pipeline call).
    const after = await checkAccountWriteRateLimit("account-me", "u1", 31_001);
    expect(after.allowed).toBe(true);
    expect(fakeRedis.ping).toHaveBeenCalledTimes(1);
    expect(fakeRedis.pipeline).not.toHaveBeenCalled();
  });

  it("__probeRedisHealth returns true on PONG and clears the failed flag", async () => {
    const fakeRedis = makeMockRedis();
    __setRedisClientForTests(fakeRedis as unknown as never);
    __markRedisFailedForTests(0);

    const ok = await __probeRedisHealth(31_001);
    expect(ok).toBe(true);

    // Subsequent call (now within back-off again would matter only if
    // failed flag were still set; clearing it means the next call
    // hits Redis directly, no PING).
    fakeRedis.ping.mockClear();
    const live = await checkAccountWriteRateLimit("account-me", "u1", 32_000);
    expect(live.allowed).toBe(true);
    expect(fakeRedis.ping).not.toHaveBeenCalled();
    expect(fakeRedis.pipeline).toHaveBeenCalledTimes(1);
  });
});
