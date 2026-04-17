# Architect Brief — Step 24: Codebase-Wide Observability
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

---

## Goal

Lay down the observability foundation: a single structured logger
(`pino`), a filled-in `/api/health` endpoint that confirms DB + Redis
are reachable, a request-ID middleware that correlates log lines to
HTTP requests, and replacement of the two `console.log` "placeholder"
alert sinks (float-alert, staleness-alert) with real structured
emits.

**Explicitly NOT in scope:** rewriting every `console.*` call site
across 72 instances. Step 24 sets the contract; the migration of
existing call sites to `log(...)` happens opportunistically whenever
those files are next touched. Boiling the ocean here would produce
an unreviewable diff.

---

## Decisions Locked

| Question | Decision |
|---|---|
| Logger library | **pino** — industry standard for Node JSON logging, fast, zero-dep runtime, structured-by-default. |
| APM / external sink | **None in this step.** Railway already aggregates stdout JSON; pino output is already SaaS-ingestable (Datadog/Axiom/etc) when we add one. |
| Request ID propagation | **`x-request-id` header**. Middleware generates one if missing (`crypto.randomUUID()`). Propagated via AsyncLocalStorage so downstream `log()` calls pick it up automatically. |
| Health endpoint location | **`GET /api/health`** — outside `/api/v1` so infra probes hit a stable URL across API versions. |
| Health check checks | DB (Prisma `SELECT 1`), Redis (ping when REDIS_URL set). Returns `{ok: true}` 200 when both pass, `{ok: false, checks: [...]}` 503 otherwise. |
| Console call migration | **Opt-in, not bulk**. Step 24 adds the logger + updates the two "placeholder" alert sinks + the webhook worker's `log()` function. Other 72 call sites stay until their file is next touched. |
| `/metrics` Prometheus endpoint | **Defer.** Railway doesn't scrape Prometheus natively; we'd need to stand up Grafana or push to a SaaS. Not worth building until we have a scrape target. |

---

## Architecture

### New module — `src/lib/obs/logger.ts`

```ts
// One pino instance. AsyncLocalStorage carries the requestId so
// callers don't thread it manually.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'kolaleaf', env: process.env.NODE_ENV ?? 'development' },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export function log(
  level: 'info' | 'warn' | 'error',
  event: string,
  data?: Record<string, unknown>,
): void
```

The `log()` helper reads the current request ID from AsyncLocalStorage
and merges it into the emitted line. When there's no active request
context (worker, cron, etc.) the line has no `requestId` field.

### New module — `src/lib/obs/request-context.ts`

`AsyncLocalStorage` wrapper that exposes `runWithRequestContext()` and
`currentRequestId()`. Used by `middleware.ts` to bracket each request.

### New — `middleware.ts` (Next.js root)

Adds `x-request-id` to the response headers. Generates one if the
incoming request lacked it. Runs the rest of the request within
`runWithRequestContext()`.

### Filled-in — `src/app/api/health/route.ts`

```ts
export async function GET() {
  const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()])
  const ok = dbOk.ok && redisOk.ok
  return NextResponse.json(
    { ok, checks: { db: dbOk, redis: redisOk } },
    { status: ok ? 200 : 503 },
  )
}
```

### Alert sink upgrades

`src/lib/rates/staleness-alert.ts` and
`src/lib/treasury/float-alert.ts` (or wherever they live — Bob
greps):
- Replace `console.log('[alert-placeholder] ...')` with
  `log('warn', 'alert.<name>', { ... })`.
- Signal shape becomes scrapeable — any future ingestion layer can
  regex on `event: alert.*`.

### Worker log() migration

`src/workers/webhook-worker.ts` currently has its own `function log`
that writes `console.log/error` JSON. Replace with the shared
`log()` from `@/lib/obs/logger`. Same shape emitted; now comes from
one pino instance with a consistent base payload.

---

## Required Tests

1. **`tests/lib/obs/logger.test.ts`** — 3 cases
   - `log('info', 'e', {x:1})` emits a line with the given event + data
   - Runs inside `runWithRequestContext('req-1', fn)` → emitted line has `requestId: 'req-1'`
   - Outside a request context → no `requestId` field

2. **`tests/e2e/health-endpoint.test.ts`** — 2 cases
   - `GET /api/health` returns 200 when DB is reachable
   - Returns 503 when a checker throws (DB mocked to reject)

3. **`tests/middleware.test.ts`** — 2 cases
   - Request without `x-request-id` header → response header set, value is a valid UUID
   - Request with existing `x-request-id` → propagated to response header

Expected delta: +7 new cases.

---

## Verification Checklist

- [ ] `npm test -- --run` → previous + 7 passing
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `rm -rf .next && npm run build` → success
- [ ] `curl -sv localhost:3000/api/health` → 200 + `x-request-id` header
- [ ] `grep -rn "^console\.\(log\|warn\|error\)" src/lib/rates/ src/lib/treasury/ src/workers/` returns zero (migrated sites)
- [ ] Brief matches: 72 `console.*` call sites NOT bulk-migrated (follow-up is file-touch opportunistic)

---

## Non-goals

- OpenTelemetry traces — separate step when we have a trace sink.
- `/metrics` Prometheus endpoint — no scrape target yet.
- Bulk migration of the remaining 72 `console.*` call sites.
- Log retention policy (Railway's default stdout retention suffices).
- Alert delivery (email/Slack) — Step 24 produces structured log lines; routing them to a channel is a separate ops task.

---

## Files Bob will touch (expected ~10)

- **New** (3): `src/lib/obs/logger.ts`, `src/lib/obs/request-context.ts`, `middleware.ts` (at repo root)
- **Modified** (3): `src/app/api/health/route.ts` (fill from stub), `src/lib/rates/staleness-alert.ts`, `src/lib/treasury/float-alert.ts` (alert sink migrations), `src/workers/webhook-worker.ts` (log() dedupe)
- **New tests** (3): logger, health endpoint, middleware
- **package.json**: `pino` dependency

One local commit: `Step 24: observability foundation — pino + request ID + /api/health + alert sinks`. No push.
