# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*

---

## Step 15 — Holistic Review + Fix (then commit Step 14+15 together)

**Goal:** Audit the completed web app + admin dashboard end-to-end. Fix everything Critical (security, correctness, data integrity, broken UX) and Major (significant UX gaps, missing error handling, observability blind spots). Defer Minor and Polish to Known Gaps. End state: a web app the Project Owner can demo to a real prospect without flinching.

**Scope:** Everything in `src/`, `prisma/`, and `tests/`. Not just the Step 13/14 delta. This is the wholistic pass.

### Phase A — Audit (no code yet)

For each category, walk the codebase and produce a findings list. Severity-tag every finding as **Critical / Major / Minor / Polish**.

1. **Security** — auth gates on every API route, KYC gating on transfer creation, webhook signature verification, webhook idempotency, no PII in logs, no admin fields exposed in user-facing endpoints, secrets only in env, `transfer_events` audit log on every state transition.
2. **Correctness** — `Decimal` (not `number`) for all money math, transfer state machine transitions are valid (per CLAUDE.md diagram), no race conditions in webhook handlers, idempotency keys on outgoing payment calls, FK constraints respected.
3. **Type safety** — `npx tsc --noEmit` clean (already 0). No `as any` or `as unknown as X`. Prisma return types not widened.
4. **Error handling + observability** — every catch logs (Richard flagged this on `/api/rates/public/route.ts:60` and `/api/rates/[corridorId]/route.ts`). User-facing errors are meaningful, never raw stack traces. Background jobs and webhook handlers log start/success/failure.
5. **Architecture consistency** — service-layer functions in `src/lib/` are not bypassed by routes (Richard flagged `RateService` bypass). New code follows existing patterns.
6. **Dead code** — unused routes, components, exports. Bob's Step 14 audit already noted `/api/rates/[corridorId]` is now unused — confirm and decide.
7. **UX consistency** — every page uses Variant D tokens + primitives. No raw Tailwind colors, no leftover legacy styling. Loading, empty, error states present and consistent. Status pills use the right tones across activity / admin transfers / admin transfer detail.
8. **Accessibility** — keyboard navigation works on send + recipients flows, all interactive elements have accessible labels, color contrast on gradient backgrounds meets WCAG AA, focus rings visible.
9. **Performance** — no N+1 queries (use `include` consistently, like the Step 14 fix), polling intervals reasonable, no client-side fetches blocking render where SSR could pre-load.
10. **Test coverage** — critical paths (state machine transitions, webhook handlers, auth, KYC gating, payout retry, rate engine override) have at least smoke coverage. Don't aim for 100% — aim for "every critical path has at least one happy + one failure test."

Token discipline: grep before read, read line ranges. Don't load files not relevant to a category. You may parallelize categories mentally but not execution — go category by category for traceability.

### Phase B — Arch confirmation

Append `### Phase A Findings — Step 15` to this brief with severity-tagged list. Stop. Wait for Arch to mark each finding **FIX-NOW** / **DEFER-TO-GAPS** / **DROP**.

### Phase C — Implementation

Implement only **FIX-NOW** items. TDD where applicable (route changes, query changes, state-machine changes). Pure refactors (logging, dead-code removal) don't need new tests but must not break existing ones.

**Constraints:**
- No new database migration without escalating first.
- No new dependencies without escalating first.
- Preserve API contracts. Add fields, do not rename.
- No visual redesign — Variant D stays as-is. UX-consistency fixes mean *applying* Variant D where missed, not redesigning it.
- All money values stay `Decimal`.
- Update `BUILD-LOG.md` for each FIX-NOW item.

### Phase D — Self-verify

- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → no new failures vs. baseline (4 known flaky in `transfers/queries.test.ts`).
- `npm run dev` + curl on at least every route you touched.
- Overwrite `handoff/REVIEW-REQUEST.md` cleanly for Step 15 (do not leave Step 14 content).
- Update `handoff/BUILD-LOG.md` Step 15 entry.

### Out of Scope

- Stub pages: `/privacy`, `/terms`, `/compliance-info`
- Mobile hamburger menu
- `/activity/[id]` page
- Account name/email display
- Login rate limiting (Major candidate — escalate before fixing if you want it in scope)
- Email verification + password reset
- Test flakiness fix (unless blocking other tests)
- Railway deployment, real provider sandboxes, Wave 2a iOS

If you find something Critical that's listed above, escalate before fixing — don't silently expand scope.

---

### Phase A Findings — Step 15

Total: 26 findings (2 Critical, 11 Major, 10 Minor, 3 Polish)

#### Category 1 — Security

- [Critical] `src/lib/payments/monoova/webhook.ts:24`, `src/lib/kyc/sumsub/webhook.ts:24`, `src/lib/payments/payout/webhooks.ts:105` — Signature verification runs on `JSON.stringify(payload)` after the route parsed the body with `JSON.parse`. The webhook routes (`api/webhooks/{monoova,paystack,sumsub}/route.ts`) already capture `rawBody` but discard it. Any provider that signs the raw HTTP body (Sumsub definitely, Monoova per their docs, Paystack for HMAC) will fail signature verification in production because re-serialization can differ in whitespace/key order. Tests sign the same re-serialized string, so this is invisible to the test suite. Fix: pass `rawBody` from route to handler, sign against `rawBody`, not `JSON.stringify(payload)`.

- [Major] `src/lib/payments/monoova/webhook.ts:31-73`, `src/lib/kyc/sumsub/webhook.ts:33-80`, `src/lib/payments/payout/webhooks.ts:44-58,118-132` — Idempotency check is a read-then-write with no atomicity. Two concurrent deliveries of the same `eventId` both pass `if (existing) return` and both call the state-transition handler before either commits the `WebhookEvent` row. The unique constraint fires on the second `create` only *after* the state transition already ran twice. Fix: try `webhookEvent.create` first inside a try/catch on unique-constraint error, use that as the dedupe lock.

- [Major] `src/app/api/transfers/[id]/route.ts:13-18` (via `getTransfer` in `src/lib/transfers/queries.ts:5-11`) — Returns the full `Transfer` row to the owner, including `failureReason` (raw internal error text), `payoutProviderRef`, and `payoutProvider`. `failureReason` may contain provider error codes, stack-trace-like text, or internal identifiers. Fix: return an explicit user-safe projection (same pattern as `listTransfers` already does for recipient fields).

- [Major] `src/app/api/admin/transfers/route.ts:31-41` — Admin list returns full transfer rows (fine for admin), but `src/app/api/admin/transfers/[id]/route.ts:14-21` uses `findUniqueOrThrow` which raises `P2025` when the id doesn't exist; error handler (line 25-28) returns the Prisma error message to the client (message may include table/field names). Fix: catch `P2025` explicitly, return 404.

- [Minor] `src/app/api/cron/*/route.ts` (all four) — Bearer token comparison with `!==` is not timing-safe. Surface is tiny (attacker already needs the full bearer to win), but the webhook layer uses `timingSafeEqual` and cron does not — inconsistency. Fix: wrap in `timingSafeEqual`.

- [Minor] `src/app/api/auth/login/route.ts:39-42` — Leaks the raw error message (`error.message`) straight to the client on any unknown login failure. A database error would surface as the HTTP body. Fix: log the raw error, return a generic "Login failed".

- [Minor] Audit log coverage — `transferEvent` is populated on every state transition (verified in `state-machine.ts:66-74`), good. But `logAuthEvent` is called on admin actions (`/refund`, `/retry`, `/pay`) and not on every admin read (stats, float, rates GET). For AUSTRAC, *admin actions* need logs; reads usually don't. Current coverage looks OK. No fix needed, just noted.

#### Category 2 — Correctness

- [Major] `src/app/api/webhooks/*/route.ts` — All four webhook routes run full processing inline (awaiting DB writes, state transitions, orchestrator calls) before returning 200 OK. CLAUDE.md explicitly requires: "Webhook handlers must be fast. Acknowledge immediately (200 OK), process via queue." Current shape means Monoova/Flutterwave retry storms if the handler is slow (>5-10s). Fix: queue (Bull/BullMQ per CLAUDE.md) and return 200 immediately. Defer if queue infra not ready — but flag loudly in Known Gaps.

- [Major] `src/lib/transfers/create.ts:104-111` — Initial `transferEvent` uses `fromStatus: 'CREATED'` and `toStatus: 'CREATED'` (self-loop). The audit trail reads nonsensically ("CREATED → CREATED"). The schema makes `fromStatus` non-null, so a real null→CREATED edge needs schema change — defer, but at minimum add `metadata: { initial: true }` so the audit log reader can filter it.

- [Minor] `src/lib/payments/monoova/webhook.ts:77-86` — Catch writes a `WebhookEvent` with `processed: false` and then re-throws. If the FIRST processing attempt throws (e.g., partial DB write, then transfer update fails), the unique constraint on `(provider, eventId)` means the second delivery will be *silently skipped* at line 35-37 because the `existing` row from the failed attempt is present. Result: stuck webhook, no retry. Fix: don't write the audit row on failure; let the unique constraint govern retries.

- [Minor] `src/lib/payments/payout/webhooks.ts:44-47` — Identical silent-skip-on-failed-row pattern as above for Flutterwave/Paystack: a row is created with `processed: false` *before* processing; if processing throws, the row exists, so retry skips. Fix: only update `processed: true` on success, delete row (or leave `processed: false` and explicitly re-run `processed: false` rows) on failure — but the cleanest pattern is the atomic create-on-unique-constraint pattern flagged above.

- [Polish] `src/lib/workers/rate-refresh.ts:30` — `rate: rate.customerRate.toNumber()` in the reporting result. Never used for math; but elsewhere in the codebase rates are stringified. Consistency nit: use `.toString()`.

#### Category 3 — Type safety

- [Major] `npx tsc --noEmit` is NOT clean — 6 errors in test files, plus 1 in `.next/types/validator.ts` (generated, safe to ignore). Specifically:
  - `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts:94,105,226,238` — 4× `TS2554` (calling `logAuthEvent` with 1 arg, expects 2). These tests may not compile, so their assertions never run.
  - `tests/lib/transfers/queries.test.ts:121,122` — 2× `TS2352` (invalid cast `as Record<string, unknown>`).
  The brief claims baseline is 0 — it's not. Fix: correct the test signatures.

- [Minor] `src/app/api/admin/transfers/route.ts:20-22`, `src/app/api/admin/compliance/route.ts:16` — `where: Record<string, unknown>` is a type escape hatch. Prisma generates proper `TransferWhereInput` / `ComplianceReportWhereInput`. Fix: use generated types.

- [Polish] No production source `as any` — good. Tests use `as any` liberally for Prisma mocks (acceptable).

#### Category 4 — Error handling + observability

- [Major] All four cron routes (`src/app/api/cron/*/route.ts:13-19`) use bare `} catch {` with no `console.error` or logger. A reconciliation failure, rate-refresh failure, or float-check failure is completely invisible. Fix: log the error with context before returning 500.

- [Major] All four webhook routes (`src/app/api/webhooks/*/route.ts`) swallow error details in the 500 branch. `handleMonoovaWebhook` etc. can throw DB errors, orchestrator errors, etc. No log line. Fix: log the error with `provider`, `eventId` (if parsable) before returning 500.

- [Major] `src/app/api/rates/public/route.ts:60`, `src/app/api/rates/[corridorId]/route.ts:24` — Bare `} catch {`; Richard already flagged this. Fix: log then return 500.

- [Major] `src/lib/workers/reconciliation.ts`, `src/lib/workers/rate-refresh.ts` — No start/success/failure logs. Only `float-alert.ts` and `staleness-alert.ts` log, and only on the alert edge. Fix: add `console.log` (or logger) at job start/end with counts.

- [Minor] `src/app/(dashboard)/send/page.tsx:51` has comment "Rate fetch failed silently — will show loading state" — the code indeed swallows the fetch error. If `/api/rates/public` is down, user sees perpetual loading with no explanation. Fix: set `setError('Could not load live rate')`.

#### Category 5 — Architecture consistency

- [Major] `src/app/api/rates/public/route.ts:29-40` bypasses `RateService` entirely — does `prisma.corridor.findFirst` and `prisma.rate.findFirst` directly. Richard flagged this. Fix: call `rateService.getCurrentRate()` (the same method `/[corridorId]` route uses) — keeps one source of truth for "what is the current rate" logic (including admin override handling, which the public route currently ignores).

- [Minor] `src/app/api/admin/rates/route.ts:5` instantiates `new RateService(new DefaultFxRateProvider())` at module scope; same in `src/app/api/rates/[corridorId]/route.ts:5`. Two instances of what should be a singleton. Fix: export a shared instance from `src/lib/rates/index.ts`.

- [Minor] Direct `prisma.*` calls in routes are widespread (`src/app/api/recipients/route.ts`, `src/app/api/admin/transfers/route.ts`, `src/app/api/admin/compliance/route.ts`, etc.). For the brownfield audit this is tolerable — but architecturally, a thin "recipients service" and "admin service" layer would centralize the `where` clauses and field projections. Defer.

#### Category 6 — Dead code

- [Major] `src/app/api/rates/[corridorId]/route.ts` — zero consumers in the codebase (only `rates/public` is used from `landing-page.tsx` and `send/page.tsx`). The `[corridorId]` route is still covered by `tests/app/api/rates/corridor.test.ts`, so deleting requires deleting the test too. Fix: delete the route and its test, OR keep as documented internal endpoint and remove from public surface.

- [Polish] Follow-up: scan remaining unused exports in `src/lib/*/index.ts` barrel files — not done in this audit.

#### Category 7 — UX consistency

- [Major] `src/app/admin/page.tsx` — Server component fetches three admin endpoints in `Promise.all`, each returning `null` on non-OK. If ANY fails silently, the page renders "—" in tiles with no diagnostic. An admin won't know whether "—" means "no data yet" or "backend is 500". Fix: render an error banner when any fetch returned null.

- [Major] `src/app/(dashboard)/send/page.tsx` — rate load has a silent failure path (see Category 4). Users will experience "I tapped send but nothing happened". Fix: surface rate-load errors.

- [Minor] `src/app/(dashboard)/activity/page.tsx` — has `loading` state (line 45) but no empty-state copy for "zero transfers yet". Users with no transfers see a blank panel. Fix: empty-state with CTA back to /send.

- [Minor] `src/app/(dashboard)/send/page.tsx` — only one `aria-busy` on the submit button; form inputs rely on implicit `<label>` wrapping. Works with screen readers but lacks explicit `htmlFor` wiring. Fix: add explicit label-input associations.

- [Polish] Status pills: `src/app/(dashboard)/activity/page.tsx`, `src/app/admin/transfers/page.tsx`, `src/app/admin/transfers/[id]/page.tsx` — all render status pills. Need a shared tone-mapper to make sure "COMPLETED" is always green, "NEEDS_MANUAL" always amber, etc. Spot check needed.

#### Category 8 — Accessibility

- [Minor] Forms use `<label>` as wrapper without `htmlFor`. Works but not the strongest pattern. Defer.

- [Minor] No visible focus-ring audit. Would need a browser pass. Defer unless you want a Phase-C item.

#### Category 9 — Performance

- [Minor] `src/app/api/admin/rates/route.ts:15-32` — for each active corridor, issues 3 queries (`getCurrentRate`, `isRateStale`, `getRateHistory`). At launch (1 corridor) this is 3 queries total. Future multi-corridor = 3N. Not urgent. Fix later: batch into a single query with Prisma relations.

- [Minor] `src/app/(dashboard)/send/page.tsx:57` polls `/api/rates/public` every 60s. Reasonable. Noted.

#### Category 10 — Test coverage

- [Minor] `/api/admin/rates` POST (admin rate override — the treasury-critical action) has no test. `POST /api/transfers` has no HTTP-layer test (only `createTransfer()` unit test). Fix: add one happy-path + one auth-denied test per.

- [Polish] Cron routes (`/api/cron/*`) have no direct HTTP tests; only the underlying worker functions (`src/lib/workers/__tests__/*`). Minor gap.

---

### Phase B — Arch triage (decisions locked)

**FIX-NOW (10 items, must all land in Step 15):**

1. **Webhook raw-body signature verification.** All 4 webhook routes (`src/app/api/webhooks/{monoova,paystack,sumsub,flutterwave}/route.ts`) capture `rawBody` then discard it. Pass `rawBody` to the handler. Sign against `rawBody`, never `JSON.stringify(payload)`. Update tests in lockstep.
2. **Webhook idempotency atomic-create.** Replace read-then-write with `try { create } catch (P2002) { return early }`. This single fix also resolves the "silent-skip-on-failed-row" variants in `monoova/webhook.ts:77-86` and `payout/webhooks.ts:44-47` — confirm by walking those paths after the fix.
3. **`getTransfer` user-safe projection.** In `src/lib/transfers/queries.ts`, add an exported `TransferUserView` shape (id, status, sendAmount, sendCurrency, receiveAmount, receiveCurrency, exchangeRate, fee, createdAt, updatedAt, completedAt, recipient projection). Strip `failureReason`, `payoutProviderRef`, `payoutProvider`, `payidProviderRef`, `kycProviderId`, internal retry counts. Update `GET /api/transfers/[id]` to return this shape. Test for the omission.
4. **Admin transfer detail P2025 → 404.** Catch `PrismaClientKnownRequestError` with code `P2025` in `src/app/api/admin/transfers/[id]/route.ts` and return `{ error: 'not_found' }, status: 404`. Don't pass through Prisma error messages.
5. **Observability.** Add `console.error('[<route|worker>]', err)` (with route/worker context) inside every bare `} catch {` in: all 4 cron routes, all 4 webhook routes, both rate routes (`/api/rates/public`, `/api/rates/[corridorId]`), and at start/end of `reconciliation.ts` and `rate-refresh.ts` workers (`console.log` start, `console.log` success with counts, `console.error` on failure).
6. **`RateService` bypass.** `src/app/api/rates/public/route.ts` calls `prisma.corridor.findFirst` + `prisma.rate.findFirst` directly. Refactor to use the existing `rateService.getCurrentRate()` (same method `/[corridorId]` uses). Add a small helper `getCurrentRateByPair(base, target)` to `src/lib/rates/` if needed. This centralizes "what is the current customer rate" logic including admin-override handling. Existing public-route tests must still pass.
7. **TS errors.** Fix the 4 `TS2554` in `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` (`logAuthEvent` 1-arg → 2-arg). Replace the 2 `as Record<string, unknown>` casts in `tests/lib/transfers/queries.test.ts:121-122` with proper typing using the `TransferListRecipient` interface plus a generic dictionary access. End state: `npx tsc --noEmit` → 0 errors. No exclusions, no `// @ts-ignore`.
8. **Admin dashboard error banner.** When any of the three admin fetches in `src/app/admin/page.tsx` returns null, render a banner component (use Variant D tokens — likely a small new primitive `<AdminAlert>` in `KolaPrimitives.tsx`, or inline; your call as long as it uses tokens). Banner says "Admin data partially unavailable. Check server logs."
9. **Send-page rate-load error surface.** In `src/app/(dashboard)/send/page.tsx`, change the silent fetch failure to `setError('Could not load live rate. Please refresh.')` so users see it instead of a perpetual shimmer.
10. **Security tightening.** (a) Cron bearer comparison: wrap the `!==` check in `crypto.timingSafeEqual` (matches webhook-layer pattern). (b) Login route: replace `error.message` leak with a generic `"Login failed"` user-facing message; log the raw error with `console.error('[auth/login]', err)`.

**DEFER to BUILD-LOG Known Gaps (do not fix in Step 15):**

- Webhook queue/ack split (BullMQ infra — separate step, possibly Step 16)
- Initial `transferEvent` CREATED→CREATED audit cosmetic (add `metadata: { initial: true }` is fine to do inline if trivially under 5 min; otherwise defer)
- `where: Record<string, unknown>` typing cleanup in admin routes
- Activity page empty-state copy + form aria associations
- Admin rate POST HTTP test, `POST /api/transfers` HTTP test, cron HTTP tests
- `RateService` singleton consolidation
- Recipients / admin service-layer centralization

**DROP (will not address):**

- Status pill tone-mapper polish
- Focus-ring audit polish
- Admin-rates N+1 polish (only relevant at multi-corridor)

**KEEP, document:**

- `/api/rates/[corridorId]` stays in place. Add a top-of-file comment: `// DEPRECATED: kept for internal/admin use. New code should call /api/rates/public?base=...&target=... or use rateService directly.`

**Build order for Phase C:**

Group by risk and concentration:

1. First wave (security-critical): items 1, 2, 4, 10 — all webhook/auth surface. Run full test suite after.
2. Second wave (correctness): items 3, 6 — query/service refactors. Run full test suite after.
3. Third wave (debuggability): items 5, 7 — observability + tsc cleanup. Run full test suite after.
4. Fourth wave (UX): items 8, 9 — small UI fixes. Smoke in browser if possible.

After each wave, commit-style mental checkpoint in your head: did anything in another wave break? If yes, stop and surface to Arch.

**Phase D self-verify (mandatory, do not skip the handoff docs this time):**

- `npx tsc --noEmit` → 0 errors. NO exclusions.
- `npm test -- --run` → no new failures vs. baseline (4 known-flaky in `transfers/queries.test.ts`). New webhook tests must pass.
- `curl` smoke for rates/public, transfers/[id], admin/transfers/[id] (the routes you changed shape on).
- **Overwrite** `handoff/REVIEW-REQUEST.md` cleanly for Step 15. Include line ranges per file. Set `Ready for Review: YES`.
- Update `handoff/BUILD-LOG.md` with Step 15 entry and add the DEFER items to Known Gaps.

Proceed to Phase C.

---

### Bob's recommended Step 15 scope

**FIX-NOW (Critical + high-value Major):**
1. Webhook raw-body signature verification (Critical, 3 files) — this is the single biggest risk for live integration; it will fail on the first real provider webhook.
2. Webhook idempotency race (Major, 3 files) — real-world risk of double state transitions under load; cheap fix using try/catch on unique constraint.
3. `getTransfer` field projection (Major, 1 file + 1 route) — prevents leaking internal `failureReason` and provider refs to users.
4. Observability on cron + webhook + rates routes (Major, ~10 files, all ~3-line additions) — directly addresses Richard's flag and CLAUDE.md's "fast ack, log everything" mandate.
5. `RateService` bypass in public rate route (Major) — Richard's flag, single service-layer call swap.
6. tsc test-file errors (Major) — 6 errors in test files; 15 min fix; removes a false-clean baseline.
7. Admin dashboard error surfacing (Major) — one banner component.
8. Send-page silent rate-load failure (Major) — one `setError` call.

**DEFER-TO-GAPS:**
- Webhook queue/ack split (Major but infra-scope; requires BullMQ work already planned for Wave 1)
- Initial `transferEvent` cosmetic (Minor)
- `Record<string, unknown>` typing cleanup (Minor)
- Dead `/api/rates/[corridorId]` route — needs an Arch call (delete or document)
- Admin rate POST test, transfer HTTP test (Minor but worth adding once Critical work settles)
- RateService singleton (Minor)

**DROP:**
- Status pill tone-mapper (Polish; works in practice)
- Focus-ring audit (Polish; needs browser session)
- Admin-rates N+1 (Polish until second corridor goes live)

Rationale: the two webhook items (#1, #2) are the only items where a real-world prospect's demo could break silently with compliance/financial consequences. Everything else in FIX-NOW is a 5-30 minute fix that removes a real rough edge. Total estimated FIX-NOW scope: 1.5-2 days including tests. This fits Step 15's "ship-ready demo" bar without scope creep.

---

## Step 14 — UI→Backend Gap Closure
**Status: CLEARED 2026-04-15.** See `handoff/REVIEW-FEEDBACK.md` and `handoff/BUILD-LOG.md` Step 14 entry.

---

## Step 1 — Project Scaffold + Database Schema

### Decisions
- Next.js 15 with TypeScript, Tailwind, App Router, src directory
- Prisma ORM with PostgreSQL (local Docker: `docker run --name kolaleaf-db -e POSTGRES_PASSWORD=kolaleaf -e POSTGRES_DB=kolaleaf -p 5432:5432 -d postgres:16`)
- vitest for testing
- DATABASE_URL: `postgresql://postgres:kolaleaf@localhost:5432/kolaleaf`
- Do NOT install payment SDKs, do NOT implement auth logic, do NOT build UI beyond default page

### Build Order
1. Initialize git repo with proper .gitignore (node_modules, .env, .next, prisma/*.db)
2. Scaffold Next.js 15: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm`
3. Install additional deps: `npm install prisma @prisma/client decimal.js && npm install -D vitest @types/node`
4. Initialize Prisma: `npx prisma init`
5. Write the full Prisma schema (see schema section below)
6. Create .env with DATABASE_URL
7. Start Postgres Docker container
8. Run migration: `npx prisma migrate dev --name init`
9. Create prisma/seed.ts with AUD-NGN corridor and test rate
10. Configure seed in package.json: `"prisma": {"seed": "npx tsx prisma/seed.ts"}`
11. Install tsx: `npm install -D tsx`
12. Run seed: `npx prisma db seed`
13. Create project directory structure (empty index.ts files for future steps)
14. Create src/lib/db/client.ts (Prisma client singleton)
15. Configure vitest in vitest.config.ts
16. Write tests: Prisma connection, seed verification, enum validation
17. Run tests, verify all pass

### Prisma Schema

Write this EXACTLY to prisma/schema.prisma (replace the default):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ──────────────────────────────────────────────

enum KycStatus {
  PENDING
  IN_REVIEW
  VERIFIED
  REJECTED
}

enum IdentifierType {
  EMAIL
  PHONE
  APPLE
  GOOGLE
}

enum TransferStatus {
  CREATED
  AWAITING_AUD
  AUD_RECEIVED
  PROCESSING_NGN
  NGN_SENT
  COMPLETED
  EXPIRED
  NGN_FAILED
  NGN_RETRY
  NEEDS_MANUAL
  REFUNDED
  CANCELLED
  FLOAT_INSUFFICIENT
}

enum PayoutProvider {
  FLUTTERWAVE
  PAYSTACK
}

enum ActorType {
  USER
  SYSTEM
  ADMIN
}

enum RewardStatus {
  PENDING
  ELIGIBLE
  PAID
  EXPIRED
}

enum ReportType {
  THRESHOLD
  SUSPICIOUS
  IFTI
}

// ─── MODELS ─────────────────────────────────────────────

model User {
  id            String           @id @default(cuid())
  fullName      String
  kycStatus     KycStatus        @default(PENDING)
  kycProviderId String?
  dailyLimit    Decimal          @default(10000) @db.Decimal(12, 2)
  referralCode  String           @unique @default(cuid())
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  identifiers   UserIdentifier[]
  sessions      Session[]
  recipients    Recipient[]
  transfers     Transfer[]
  referredBy    Referral?        @relation("referred")
  referrals     Referral[]       @relation("referrer")
}

model UserIdentifier {
  id         String         @id @default(cuid())
  userId     String
  type       IdentifierType
  identifier String         @unique
  verified   Boolean        @default(false)
  verifiedAt DateTime?
  createdAt  DateTime       @default(now())
  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Recipient {
  id            String     @id @default(cuid())
  userId        String
  fullName      String
  bankName      String
  bankCode      String
  accountNumber String
  isVerified    Boolean    @default(false)
  createdAt     DateTime   @default(now())
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  transfers     Transfer[]
}

model Transfer {
  id                String         @id @default(cuid())
  userId            String
  recipientId       String
  corridorId        String
  sendAmount        Decimal        @db.Decimal(12, 2)
  sendCurrency      String         @default("AUD")
  receiveAmount     Decimal        @db.Decimal(15, 2)
  receiveCurrency   String         @default("NGN")
  exchangeRate      Decimal        @db.Decimal(12, 6)
  fee               Decimal        @default(0) @db.Decimal(12, 2)
  status            TransferStatus @default(CREATED)
  payidReference    String?
  payidProviderRef  String?
  payoutProvider    PayoutProvider?
  payoutProviderRef String?
  failureReason     String?
  retryCount        Int            @default(0)
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  completedAt       DateTime?
  user              User           @relation(fields: [userId], references: [id])
  recipient         Recipient      @relation(fields: [recipientId], references: [id])
  corridor          Corridor       @relation(fields: [corridorId], references: [id])
  events            TransferEvent[]
}

model TransferEvent {
  id         String         @id @default(cuid())
  transferId String
  fromStatus TransferStatus
  toStatus   TransferStatus
  actor      ActorType
  actorId    String?
  metadata   Json?
  createdAt  DateTime       @default(now())
  transfer   Transfer       @relation(fields: [transferId], references: [id], onDelete: Cascade)
}

model Corridor {
  id             String     @id @default(cuid())
  baseCurrency   String
  targetCurrency String
  active         Boolean    @default(true)
  minAmount      Decimal    @db.Decimal(12, 2)
  maxAmount      Decimal    @db.Decimal(12, 2)
  payoutProviders Json      @default("[]")
  createdAt      DateTime   @default(now())
  transfers      Transfer[]
  rates          Rate[]

  @@unique([baseCurrency, targetCurrency])
}

model Rate {
  id            String   @id @default(cuid())
  corridorId    String
  provider      String?
  wholesaleRate Decimal  @db.Decimal(12, 6)
  spread        Decimal  @db.Decimal(8, 6)
  customerRate  Decimal  @db.Decimal(12, 6)
  effectiveAt   DateTime @default(now())
  expiresAt     DateTime?
  adminOverride Boolean  @default(false)
  setById       String?
  createdAt     DateTime @default(now())
  corridor      Corridor @relation(fields: [corridorId], references: [id])
}

model Referral {
  id                  String       @id @default(cuid())
  referrerId          String
  referredUserId      String       @unique
  referralCode        String
  rewardStatus        RewardStatus @default(PENDING)
  rewardAmount        Decimal?     @db.Decimal(12, 2)
  completedTransferId String?
  createdAt           DateTime     @default(now())
  referrer            User         @relation("referrer", fields: [referrerId], references: [id])
  referredUser        User         @relation("referred", fields: [referredUserId], references: [id])
}

model ComplianceReport {
  id         String     @id @default(cuid())
  type       ReportType
  transferId String?
  userId     String?
  details    Json
  reportedAt DateTime?
  austracRef String?
  createdAt  DateTime   @default(now())
}

model WebhookEvent {
  id          String   @id @default(cuid())
  provider    String
  eventId     String
  eventType   String
  payload     Json
  processed   Boolean  @default(false)
  processedAt DateTime?
  createdAt   DateTime @default(now())

  @@unique([provider, eventId])
}
```

### Directory Structure

Create these files (empty exports for now, just establishing the structure):

- `src/lib/db/client.ts` — Prisma client singleton (actual implementation)
- `src/lib/transfers/index.ts` — `export {}` placeholder
- `src/lib/payments/index.ts` — `export {}` placeholder
- `src/lib/kyc/index.ts` — `export {}` placeholder
- `src/lib/auth/index.ts` — `export {}` placeholder
- `src/lib/rates/index.ts` — `export {}` placeholder
- `src/lib/compliance/index.ts` — `export {}` placeholder

### Prisma Client Singleton (src/lib/db/client.ts)

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

### Seed File (prisma/seed.ts)

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Create AUD-NGN corridor
  const corridor = await prisma.corridor.upsert({
    where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
    update: {},
    create: {
      baseCurrency: 'AUD',
      targetCurrency: 'NGN',
      active: true,
      minAmount: 10,
      maxAmount: 50000,
      payoutProviders: ['FLUTTERWAVE', 'PAYSTACK'],
    },
  })

  // Create initial test rate
  await prisma.rate.create({
    data: {
      corridorId: corridor.id,
      provider: 'seed',
      wholesaleRate: 1050.00,
      spread: 0.007,
      customerRate: 1042.65,
      effectiveAt: new Date(),
    },
  })

  console.log('Seed complete: AUD-NGN corridor with test rate')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
```

### Tests (tests/lib/db/foundation.test.ts)

```typescript
import { describe, it, expect, afterAll } from 'vitest'
import { PrismaClient, KycStatus, TransferStatus, IdentifierType } from '@prisma/client'

const prisma = new PrismaClient()

afterAll(async () => { await prisma.$disconnect() })

describe('Database foundation', () => {
  it('connects to PostgreSQL', async () => {
    const result = await prisma.$queryRaw`SELECT 1 as connected`
    expect(result).toEqual([{ connected: 1 }])
  })

  it('AUD-NGN corridor exists from seed', async () => {
    const corridor = await prisma.corridor.findUnique({
      where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
    })
    expect(corridor).not.toBeNull()
    expect(corridor!.active).toBe(true)
    expect(Number(corridor!.minAmount)).toBe(10)
    expect(Number(corridor!.maxAmount)).toBe(50000)
  })

  it('test rate exists for AUD-NGN corridor', async () => {
    const corridor = await prisma.corridor.findUnique({
      where: { baseCurrency_targetCurrency: { baseCurrency: 'AUD', targetCurrency: 'NGN' } },
    })
    const rate = await prisma.rate.findFirst({
      where: { corridorId: corridor!.id },
      orderBy: { effectiveAt: 'desc' },
    })
    expect(rate).not.toBeNull()
    expect(Number(rate!.customerRate)).toBeGreaterThan(0)
  })

  it('TransferStatus enum has all expected values', () => {
    const expected = [
      'CREATED', 'AWAITING_AUD', 'AUD_RECEIVED', 'PROCESSING_NGN',
      'NGN_SENT', 'COMPLETED', 'EXPIRED', 'NGN_FAILED', 'NGN_RETRY',
      'NEEDS_MANUAL', 'REFUNDED', 'CANCELLED', 'FLOAT_INSUFFICIENT',
    ]
    const actual = Object.values(TransferStatus)
    expect(actual).toEqual(expect.arrayContaining(expected))
    expect(actual.length).toBe(expected.length)
  })

  it('KycStatus enum has all expected values', () => {
    expect(Object.values(KycStatus)).toEqual(['PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED'])
  })

  it('IdentifierType enum has all expected values', () => {
    expect(Object.values(IdentifierType)).toEqual(['EMAIL', 'PHONE', 'APPLE', 'GOOGLE'])
  })
})
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### Flags
- Flag: Use `@db.Decimal(12, 2)` for money amounts. Never use float.
- Flag: The `cuid()` default for IDs. Not uuid. Shorter, URL-safe, sortable.
- Flag: `onDelete: Cascade` on UserIdentifier and Session (delete user = delete their identifiers and sessions). Do NOT cascade on Transfer or Recipient.
- Flag: The Corridor `@@unique([baseCurrency, targetCurrency])` constraint is critical for multi-corridor support.
- Flag: Add `"test": "vitest run"` and `"test:watch": "vitest"` to package.json scripts.

### Definition of Done
- [ ] Git repo initialized with .gitignore
- [ ] Next.js 15 app runs (`npm run dev`)
- [ ] Prisma schema compiles and migrates without errors
- [ ] Seed creates AUD-NGN corridor with test rate
- [ ] All 6 tests pass (`npm test`)
- [ ] Project directory structure matches the spec
- [ ] .env file exists with DATABASE_URL (and is in .gitignore)

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
