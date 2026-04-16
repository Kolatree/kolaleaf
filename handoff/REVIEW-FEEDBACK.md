# Review Feedback — Step 15i
Date: 2026-04-15
Ready for Builder: YES

## Must Fix

None.

## Should Fix

- `src/workers/webhook-worker.ts:118,123` — after `verify()` succeeds, the worker re-reads `process.env.FLUTTERWAVE_WEBHOOK_SECRET!` / `PAYSTACK_SECRET_KEY!` with non-null assertions. Harmless today (verify already threw on missing, env vars don't mutate mid-function), but two lookups invite future drift. Cache the secret as a local after verify, or have `verify()` return the resolved secret. Log to BUILD-LOG if not fixed inline.

- `src/workers/webhook-worker.ts` — no `worker.on('error', ...)` listener. ioredis connection errors can surface as unhandled `error` events on the Worker. Add a logging handler; BullMQ reconnects on its own. Not blocking; log to BUILD-LOG.

- Test parity: only the Monoova route test was rewritten for the dispatcher path. Flutterwave / Paystack / Sumsub routes received identical treatment in code but no equivalent route-level test covers the 401-no-dispatch / 200-dispatch gate. The three new queue tests plus the Monoova route test are sufficient for this step, but a regression in one of the other three routes' sig-verify-before-dispatch ordering would slip through. Log a follow-up to bring the other three route tests to parity.

## Escalate to Architect

None.

## Cleared

Reviewed the four dispatcher/queue source files, the worker, the extracted `verify-signature.ts`, all four webhook routes, and the three new queue tests plus the rewritten Monoova route test. Confirmed via `git status` / `git diff --stat` that untouched surfaces (Monoova / payout / Sumsub webhook handler internals, Prisma schema, state machine) were not modified.

Verified:

- **Route order**: `request.text()` once, JSON parse guard, secret check, signature verify BEFORE dispatch. Invalid signature → 401, no dispatcher call. Valid → dispatch + 200 `{ received: true }`. Dispatcher throw → 500 (provider retries). Bad JSON → 400.
- **Defense-in-depth**: worker re-verifies signature per attempt against its own env-read secret before calling the handler. Does not trust the enqueued `signature` field.
- **Secret handling**: job payload is `{ provider, rawBody, signature, receivedAt }` — no secrets on the wire. Dispatcher reads `FLUTTERWAVE_WEBHOOK_SECRET` / `PAYSTACK_SECRET_KEY` at dispatch time; worker re-reads at process time. Monoova and Sumsub handlers read their own secrets internally, matching pre-15i behavior.
- **jobId correctness**: SHA-256 computed over `rawBody` (not `JSON.stringify(payload)`) — the 15a regression is not reintroduced. Dedup is stable across two identical rawBodies (`bullmq-dispatcher.test.ts:87-107`).
- **Env-driven selector**: `getWebhookDispatcher()` returns `InProcessDispatcher` when `REDIS_URL` is unset OR blank-whitespace; `BullMQDispatcher` otherwise. Cached; `__resetWebhookDispatcher()` exposed for tests. No code path constructs a BullMQ `Queue` when Redis is absent.
- **Handler call-site signatures** match every handler export:
  - `handleMonoovaWebhook(rawBody, signature)` ✓
  - `handleSumsubWebhook(rawBody, signature)` ✓
  - `handleFlutterwaveWebhook(rawBody, signature, secret)` ✓
  - `handlePaystackWebhook(rawBody, signature, secret)` ✓
- **ioredis connection**: `maxRetriesPerRequest: null` for BullMQ compatibility, `enableReadyCheck: true`, reconnection defaults not disabled. `createRedisConnection` is reused via `BullMQDispatcher` construction; the Queue is cached in the selector so the connection is not per-dispatch.
- **Graceful shutdown**: SIGINT/SIGTERM → `worker.close()` + `connection.quit()` + `process.exit(0)`. Production-ready; not a gap.

Signal to Arch: **Step 15i is clear.**
