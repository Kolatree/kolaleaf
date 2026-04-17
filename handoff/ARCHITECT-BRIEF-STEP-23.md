# Architect Brief — Step 23: BullMQ Email Queue
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

---

## Goal

Move every Resend email send off the request path onto a durable,
retryable BullMQ queue. Users see a 200 back in <50ms regardless of
Resend latency or transient provider errors; deliveries survive a
single Resend hiccup via the worker's retry policy; permanent failures
land in a `FailedEmail` table the admin dashboard can surface.

The existing `webhooks` queue pattern is the reference architecture —
this step is "add a second queue of the same shape".

---

## Why now

- The `simplify` pass made p50 `/send-code` drop from 400-900ms to
  ~20ms by fire-and-forget-ing Resend's promise. That's a **latency**
  improvement but a **reliability regression**: a fire-and-forget
  `.catch(err => console.error(err))` silently drops failed emails.
  Users re-request codes not knowing the first one never shipped.
- Durable queueing gives us the latency win AND the reliability —
  retry on transient failures, record permanent ones.
- BullMQ is already installed and operational (`webhooks` queue).
  The dispatcher pattern auto-falls-back to in-process when
  `REDIS_URL` is unset — dev and CI get the same queue semantics
  with no Redis dependency.

---

## Decisions Locked

| Question | Decision |
|---|---|
| Queue name | `email` (parallel to `webhooks`). |
| Job id | `jobId = sha256(email + template + tokenOrCodeHash)` — idempotent, prevents duplicate sends on route retries. |
| Retry policy | `attempts: 8, backoff: exponential starting at 5s`. Longer than webhooks (we care more about actually reaching the user) and capped by the final attempt at ~10min. |
| `removeOnComplete` | `1000` — keep the last 1000 successful jobs for ops visibility. |
| `removeOnFail` | `false` — failed jobs stay in the failed set until manually cleaned, AND are also copied to `FailedEmail` table (see below). |
| Permanent-failure sink | **`FailedEmail` table** (new). BullMQ's failed-set is opaque; a DB row is query-able from the admin dashboard. |
| Dev fallback | **In-process dispatcher** mirrors the webhook pattern. `REDIS_URL` absent → jobs run in the same process, with the same retry policy. Local UX unchanged. |
| Route contract change | **All three call sites become 200/202 always.** Delivery signal is decoupled from the HTTP response. See §Contract Changes below. |
| Worker process | Add `email` queue to the existing `webhook-worker.ts` entry point OR give it its own worker file — Bob picks based on current worker code shape (read it first). If the existing worker is a single-queue boot, split it into a shared `boot-worker.ts` that takes a queue list. |
| Observability hook | Emit a structured log on every job event: `enqueued`, `attempt`, `completed`, `failed_permanent`. Step 24 picks these up when it lands. Don't block on Step 24. |

---

## Schema Changes

### `prisma/schema.prisma`

```prisma
model FailedEmail {
  id           String   @id @default(cuid())
  toEmail      String
  template     String   // 'verification_code' | 'password_reset' | ...
  payloadHash  String   // sha256 of the job payload for forensics
  attempts     Int
  lastError    String
  failedAt     DateTime @default(now())
  resolvedAt   DateTime?
  resolvedBy   String?  // admin user id

  @@index([toEmail])
  @@index([failedAt])
  @@index([resolvedAt])
}
```

Migration: `prisma/migrations/<ts>_failed_email/migration.sql` —
pure additive table, zero backfill.

---

## Architecture

### New modules

- **`src/lib/queue/email-queue.ts`**
  - Exports `EMAIL_QUEUE_NAME = 'email'`, `EmailJobData` type, `EMAIL_JOB_OPTS`.
  - `enqueueEmail(data: EmailJobData)` — single entry for callers. Selects `BullMQDispatcher` or `InProcessDispatcher` the same way `webhooks` does.

- **`src/lib/queue/email-handler.ts`**
  - The worker-side handler. Receives a job, calls `sendEmail(data)` (the existing Resend wrapper), rethrows on error so BullMQ retries.
  - On the **final attempt only**, catches the error, writes a `FailedEmail` row, and rethrows (so BullMQ marks failed).
  - Uses `job.attemptsMade === job.opts.attempts` to detect "last chance".

- **`src/workers/email-worker.ts`** (or folded into `webhook-worker.ts` — Bob's call)
  - Standalone process boot. `new Worker(EMAIL_QUEUE_NAME, emailHandler, { connection })`.

- **Railway config change** (`railway.json` or equivalent)
  - Add a second service pointing at `email-worker.ts`, OR combine into a single multi-queue worker process. Match existing deploy topology.

### Types

```ts
export type EmailTemplate = 'verification_code' | 'password_reset'

export type EmailJobData =
  | {
      template: 'verification_code'
      toEmail: string
      recipientName: string
      code: string           // 6-digit code, NOT the hash — worker sends it
      purpose: 'pending_registration' | 'change_email'
    }
  | {
      template: 'password_reset'
      toEmail: string
      recipientName: string
      resetToken: string     // raw token; worker interpolates the URL
    }
```

---

## Contract Changes (the tricky bit)

### `src/lib/auth/pending-email-verification.ts:issuePendingEmailCode`

**Before:** returns `{ ok: false, reason: 'send_failed' }` on Resend
error → caller surfaces that to user.

**After:** returns `{ ok: true }` after `enqueueEmail(...)`. The send
failure signal is gone from the sync path.

Rationale: send failures become a tail-probability event (1 in 10k
with 8 retries over 10 min). Surfacing them to the user caused
duplicate-code-request loops because users retry when they don't see
the email. With the queue: they wait, the email arrives, done.
Enumeration-proof route already returns 200 regardless; consistency
preserved.

### `src/app/api/v1/auth/request-password-reset/route.ts`

No contract change — already generic 200.

### `src/lib/auth/email-verification.ts:issueVerificationCode`

Already bare-await discarded result. No signal to the caller. Clean
swap to `enqueueEmail`.

### Route tests

All three routes have existing tests that mock `sendEmail`. Update to
mock `enqueueEmail` instead; assertion shape becomes "a job was
enqueued with `{template, toEmail, ...}`" rather than "sendEmail was
called with X".

---

## Required Tests (TDD-first)

### New tests

1. **`tests/lib/queue/email-queue.test.ts`** — 5 cases
   - `enqueueEmail({template: 'verification_code', ...})` calls the dispatcher with correct shape
   - Idempotent: two enqueue calls with the same data produce only one job in the queue (jobId dedupe)
   - In-process dispatcher: runs handler synchronously on first attempt, retries on failure
   - BullMQ dispatcher: passes job to `queue.add` with correct opts
   - Dispatcher selector: `REDIS_URL` set → BullMQ; unset → in-process

2. **`tests/lib/queue/email-handler.test.ts`** — 6 cases
   - Calls `sendEmail` with the job data
   - Rethrows on Resend error (triggering retry)
   - On last attempt + failure: writes a `FailedEmail` row AND rethrows
   - Template routing: verification_code path calls renderVerificationEmail; password_reset path calls renderPasswordResetEmail
   - `FailedEmail.payloadHash` is deterministic over the same input
   - `FailedEmail.lastError` contains the Resend error message

3. **`tests/e2e/email-queue-smoke.test.ts`** — 3 cases
   - Full path: `POST /api/v1/auth/send-code` → enqueued job → handler → `PendingEmailVerification` row written → email sent (via test transport)
   - Resend transient error: retried, eventually succeeds, no FailedEmail row
   - Resend permanent error: retried to exhaustion, FailedEmail row present

### Modified tests

4. The three existing route tests that previously asserted on `sendEmail` calls now assert on `enqueueEmail` calls. ~3 cases each × 3 files = ~9 assertions updated, not new cases.

Expected delta: +14 new cases, ~9 updates.

---

## Verification Checklist (Bob, before REVIEW-REQUEST)

- [ ] `npm test -- --run` → baseline + 14 passing.
- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] `rm -rf .next && npm run build` → success.
- [ ] Local (no Redis): register wizard end-to-end. Email arrives in console output (dev Resend stub). `PendingEmailVerification` row exists. No `FailedEmail` row.
- [ ] Local (with Redis, docker): same path. Job visible in queue UI (or via `bullmq-board` if installed; else `redis-cli KEYS bull:email:*`).
- [ ] Simulate Resend failure (set `RESEND_API_KEY=bogus` in dev): final attempt writes a `FailedEmail` row. Verify `lastError` non-empty, `attempts === 8`.
- [ ] Admin route inventory: no new `/api/v1/admin/failed-emails` route yet (defer to a follow-up; this brief is queue-only).

---

## Deploy Plan (Arch)

- Migration (`FailedEmail` table) is a pure addition. Safe on Railway release phase.
- Worker topology: whether it's a new Railway service or folds into existing worker, confirm the env has `REDIS_URL` (already set — webhooks queue uses it).
- Rollback: `git revert` + `DROP TABLE "FailedEmail"` + Resend sends go back to the request path. Users see slower responses but nothing breaks.
- Canary: Can deploy behind a flag (`EMAIL_QUEUE_ENABLED`) if we want to A/B. Not recommended — the latency win alone is worth the atomic switch.

---

## Non-goals

- Admin dashboard surface for `FailedEmail` rows — follow-up step.
- Email template re-render consistency (idempotent renders) — not a current problem.
- Multi-region queue — single-region Railway is fine at our volume.
- Webhook queue changes — untouched.

---

## Files Bob will touch (expected ~12)

- **New** (4): `src/lib/queue/email-queue.ts`, `src/lib/queue/email-handler.ts`, `src/workers/email-worker.ts` (or merged into existing), `prisma/migrations/<ts>_failed_email/migration.sql`
- **New tests** (3): `tests/lib/queue/email-queue.test.ts`, `tests/lib/queue/email-handler.test.ts`, `tests/e2e/email-queue-smoke.test.ts`
- **Modified** (5): `prisma/schema.prisma`, `src/lib/auth/email-verification.ts`, `src/lib/auth/pending-email-verification.ts`, `src/app/api/v1/auth/request-password-reset/route.ts`, the 3 existing route tests (test mocks change, not shape)
- **Possibly modified** (1): `railway.json` if a second worker service is added

One local commit: `Step 23: email sends on BullMQ queue with FailedEmail sink`. No push.
