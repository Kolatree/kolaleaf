# Review Request -- Step 15i

**Step:** 15i -- BullMQ + Redis webhook queue
**Date:** 2026-04-15
**Builder:** Bob
**Ready for Review:** YES

---

## Summary

Webhook routes no longer process inline. They now verify the provider
signature synchronously and hand the raw payload to a dispatcher, returning
200 immediately. The dispatcher is environment-driven:

- `REDIS_URL` set -> `BullMQDispatcher` enqueues on the `webhooks` queue;
  a standalone worker (`npm run worker`) consumes and dispatches to the
  existing handler functions.
- `REDIS_URL` absent/blank -> `InProcessDispatcher` calls the handler
  directly in-process (dev/tests path -- no Redis required).

No handler internals, schema, state-machine, audit, or idempotency logic
changed. Handler-level signature verification stays. Handler-level
WebhookEvent unique-constraint idempotency stays.

New deps: `bullmq`, `ioredis`. Nothing else.

---

## Files to Review

### New files

- `src/lib/queue/webhook-dispatcher.ts` -- interface + `WebhookJob` type
  + `WEBHOOK_QUEUE_NAME` constant.
- `src/lib/queue/in-process-dispatcher.ts` -- `InProcessDispatcher`
  implementation; switch on `provider`, hand to existing handler.
- `src/lib/queue/bullmq-dispatcher.ts` -- `BullMQDispatcher`,
  `WEBHOOK_JOB_OPTS`, `createRedisConnection`. `jobId` = SHA-256 of
  rawBody for enqueue-time dedup.
- `src/lib/queue/index.ts` -- `getWebhookDispatcher()` selector
  (lazy + cached) + `__resetWebhookDispatcher()` test hook.
- `src/lib/payments/payout/verify-signature.ts` --
  `verifyFlutterwaveSignature` (static secret, constant-time) and
  `verifyPaystackSignature` (HMAC-SHA512 over rawBody). Extracted
  from what was inline in `payout/webhooks.ts` so the route can verify
  BEFORE enqueue.
- `src/workers/webhook-worker.ts` -- BullMQ Worker entry. Re-verifies
  signature per attempt (defense-in-depth), dispatches to handlers,
  structured JSON logs, graceful shutdown.
- `tests/lib/queue/in-process-dispatcher.test.ts` (7 tests)
- `tests/lib/queue/bullmq-dispatcher.test.ts` (7 tests)
- `tests/lib/queue/selector.test.ts` (5 tests)

### Modified files

- `src/app/api/webhooks/monoova/route.ts` (lines 1-43) -- pre-flight
  signature verification via `verifyMonoovaSignature`, then
  `getWebhookDispatcher().dispatch(...)`. 200 received, 401 on bad sig
  (no dispatch), 400 on bad JSON, 500 if dispatcher throws.
- `src/app/api/webhooks/flutterwave/route.ts` (lines 1-43) -- same
  shape, `verifyFlutterwaveSignature` + dispatch.
- `src/app/api/webhooks/paystack/route.ts` (lines 1-43) -- same shape,
  `verifyPaystackSignature` + dispatch.
- `src/app/api/webhooks/sumsub/route.ts` (lines 1-41) -- same shape,
  `verifySumsubSignature` + dispatch.
- `tests/app/api/webhooks/monoova.test.ts` -- rewritten to mock the
  dispatcher and signature-verify helper; asserts invalid-sig doesn't
  dispatch, valid-sig dispatches + 200, dispatcher throw -> 500,
  missing secret -> 500, bad JSON -> 400.
- `package.json` (line 12) -- `"worker"` script, bullmq + ioredis deps.
- `.env`, `.env.example` -- `REDIS_URL=` block with usage comment.
- `handoff/BUILD-LOG.md` -- Step 15i entry.

---

## One-sentence-per-change highlights

- Dispatcher abstraction isolates routes from BullMQ so tests stay
  hermetic without Redis.
- SHA-256(rawBody) `jobId` gives enqueue-time dedup on top of the
  handler's WebhookEvent unique constraint.
- Routes verify signature BEFORE dispatch to prevent junk-payload DoS
  on the queue.
- Worker re-verifies signature per attempt for defense-in-depth against
  a compromised producer.
- `InProcessDispatcher` preserves current dev/test semantics exactly:
  the route awaits the handler, 500 on handler error, 200 on success.
- No schema migration, no new handler behavior, no change to
  idempotency or state machine.

---

## Open Questions

None. Scope was locked to what the brief specified.

---

## Phase D verification

- `npx tsc --noEmit` -> 0 errors
- `npm test -- --run` -> **565 passed / 0 failed** across 80 files
  (545 pre-existing + 20 new queue/route tests)
- Manual smoke (`REDIS_URL` unset): signed Monoova payload via
  `POST` -> 200 `{received:true}`; bad signature -> 401. In-process
  dispatcher invoked the handler, payment event was processed via the
  existing `handleMonoovaWebhook` path.

---

## Local Redis (optional, for the queue path)

```
docker run --name kolaleaf-redis -p 6379:6379 -d redis:7
export REDIS_URL=redis://localhost:6379
npm run worker   # one terminal
npm run dev      # another
```

Leave `REDIS_URL` blank for normal dev/tests. The dispatcher selector
transparently picks the in-process fallback.
