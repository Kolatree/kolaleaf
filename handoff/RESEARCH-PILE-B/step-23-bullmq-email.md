# Step 23 — BullMQ email queue — research

## Resend call sites

- `src/lib/auth/email-verification.ts:63` → verification code (registered user re-verify flow); `await sendEmail(...)` — result not checked, bare await
- `src/lib/auth/pending-email-verification.ts:114` → verification code (pre-registration pending flow); result checked, returns `{ ok: false, reason: 'send_failed' }` on error
- `src/app/api/auth/request-password-reset/route.ts:92` → password reset link; bare `await sendEmail(...)`, result discarded, caught by outer try/catch which returns generic 200

All three call `sendEmail()` from `src/lib/email/send.ts` which calls `resend.emails.send()` synchronously in the request path. None are fire-and-forget (`.catch()` style) — they are awaited but the request blocks on the Resend round-trip.

## BullMQ status

- installed: yes, `^5.74.1` (also ioredis `^5.10.1`)
- existing queues: `webhooks` queue only (`WEBHOOK_QUEUE_NAME`)
- worker pattern: `src/workers/webhook-worker.ts` — standalone process, also supports in-process boot via `bootInProcessWorker()` when `REDIS_URL` is set

## Redis connection

- env var: `REDIS_URL`
- connection helper: `src/lib/queue/bullmq-dispatcher.ts` → `createRedisConnection(url)` (exported, reusable)

## Existing retry/DLQ pattern

`WEBHOOK_JOB_OPTS` in `bullmq-dispatcher.ts`: `attempts: 5`, exponential backoff starting at 2s, `removeOnComplete: 1000`, `removeOnFail: 5000`. No explicit DLQ — failed jobs sit in BullMQ's failed set (kept for 5000 entries). Worker rethrows on failure, letting BullMQ drive retries. No dead-letter queue wired to a separate queue.

Dispatcher selector in `src/lib/queue/index.ts`: uses `InProcessDispatcher` when `REDIS_URL` absent (dev/test), `BullMQDispatcher` when present. Same pattern applies cleanly to an email queue.

## Current email wrapper

- `src/lib/email/client.ts` — Resend client, lazy init, dev fallback to `console.log`
- `src/lib/email/send.ts` — `sendEmail()`, single entry point
- `src/lib/email/index.ts` — re-exports `sendEmail`, `renderVerificationEmail`, `renderPasswordResetEmail`
- is fire-and-forget: **no** — all call sites `await` the result. The simplify commit moved to a shared `sendEmail` wrapper but kept it synchronous/awaited in-request.

## Open questions for Arch

- Keep Resend sync (`InProcessDispatcher`-style) as dev fallback, or require Redis in dev too?
- Email queue retry policy: same 5-attempt exponential as webhooks, or shorter (emails are user-facing, fast retry matters more)?
- On permanent failure (all retries exhausted): log only, or write to a `failed_emails` DB table for admin visibility?
- `pending-email-verification.ts` checks `result.ok` and surfaces a send error to the caller — after queueing, that signal is gone. Does the API route need to change its contract (always 202, never surface send errors)?
