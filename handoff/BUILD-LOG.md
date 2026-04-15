# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** 15c -- Schema migration foundation for auth/verification/2FA (review pending)
**Last cleared:** Step 15b
**Pending deploy:** NO

---

## Step History

### Step 15c -- Schema migration foundation for auth/verification/2FA -- REVIEW PENDING
*Date: 2026-04-15*

Pure schema step. Adds the database foundation for the auth work landing in 15d-15g
(email/phone verification, password reset, 2FA via TOTP/SMS). Zero application-logic
changes. Additive migration only — no drops, no renames.

Files changed:
- `prisma/schema.prisma` -- added `TwoFactorMethod` enum (NONE/TOTP/SMS); extended `User`
  with `twoFactorMethod` (default NONE), `twoFactorSecret?`, `twoFactorBackupCodes` (default []),
  `twoFactorEnabledAt?`; added 4 new models: `EmailVerificationToken`, `PasswordResetToken`,
  `PhoneVerificationCode`, `TwoFactorChallenge`; added 4 back-relations to `User`.
- `prisma/migrations/20260415113525_auth_verification_2fa/migration.sql` -- generated
  additive migration (CREATE TYPE, ADD COLUMN, CREATE TABLE, CREATE INDEX, ADD CONSTRAINT).
- `src/generated/prisma/**` -- regenerated Prisma Client (7.7.0) with new models + enum.

Decisions:
- Email/phone verification status stays on `UserIdentifier.verified` + `verifiedAt` per the
  brief's explicit constraint. No `User.emailVerified` / `User.phoneVerified` added.
- Existing legacy 2FA fields (`totpSecret`, `totpEnabled`, `backupCodes`) are untouched. The
  new `twoFactor*` fields are the go-forward surface; migrating legacy values is out of scope
  for 15c and will be handled in 15d-15g (or a later consolidation step).
- `PhoneVerificationCode` handles phone-add / phone-change flows. Per-login SMS 2FA codes
  live in `TwoFactorChallenge.codeHash` (NULL for TOTP challenges).
- `twoFactorSecret` stored plain for now per brief; encryption at rest planned for 15j.
- `PhoneVerificationCode.attempts` and `TwoFactorChallenge.attempts` default 0; lock logic
  belongs in application code (15d-15g), not the schema.
- All 4 new models use `onDelete: Cascade` on the `User` FK so a deleted user's pending
  verification/reset/challenge records are cleaned up automatically.
- Indexes on `userId` and `expiresAt` for each new model — supports lookup-by-user and the
  cleanup/expiry sweep job that will land in 15d-15g.

Verification:
- `npx prisma validate` -- schema valid.
- `npx prisma generate` -- client regenerated cleanly.
- `npx prisma migrate dev --name auth_verification_2fa --create-only` -- inspected SQL;
  purely additive (no DROP, no RENAME).
- `npx prisma migrate deploy` -- applied to local DB.
- `docker exec kolaleaf-db psql -U postgres -d kolaleaf -c "\dt"` -- confirms all 4 new
  tables present (EmailVerificationToken, PasswordResetToken, PhoneVerificationCode,
  TwoFactorChallenge) alongside existing 13.
- `\d "User"` -- confirms 4 new `twoFactor*` columns with correct defaults.
- `npx tsc --noEmit` -- 0 errors (generated Prisma types additive, nothing breaks).
- `npm test -- --run` -- 392/392 passing (same as 15b baseline; no regressions).
- `npx prisma db seed` -- succeeds; seed does not touch the new tables.

### Step 15b -- FIX-NOW Cleanup (projection, RateService, observability, banner) -- REVIEW PENDING
*Date: 2026-04-15*

Closes the 6 remaining FIX-NOW items from the Step 15 audit (#3, #5, #6, #7, #8, #9).
Items #1, #2, #4, #10 landed in Step 15a.

Files changed:
- `src/lib/transfers/queries.ts` -- new exported `TransferUserView` interface; `getTransfer` now uses an explicit `USER_SAFE_TRANSFER_SELECT` projection so internal fields (`failureReason`, `payoutProviderRef`, `payoutProvider`, `payidProviderRef`, `payidReference`, `retryCount`) are stripped from user-facing routes. Admin routes already use `prisma.transfer` directly so no `getTransferAdmin()` shim was needed.
- `src/lib/rates/rate-service.ts` -- new `getCurrentRateByPair(base, target)` helper; resolves corridor by pair then delegates to `RateService.getCurrentRate(corridorId)`. Single source of truth for "current customer rate" logic, so admin overrides and ordering rules are honored uniformly.
- `src/lib/rates/index.ts` -- export the new helper.
- `src/app/api/rates/public/route.ts` -- refactored to call `getCurrentRateByPair` instead of `prisma.corridor.findFirst` + `prisma.rate.findFirst`. Bare catch replaced with `console.error('[api/rates/public]', err)`.
- `src/app/api/rates/[corridorId]/route.ts` -- bare catch replaced with `console.error('[api/rates/[corridorId]]', err)`.
- `src/app/api/webhooks/{monoova,sumsub,flutterwave,paystack}/route.ts` -- JSON-parse-error catches now log `console.error('[webhooks/<provider>] invalid payload', err)`. Main handler catch already logs from Step 15a.
- `src/lib/workers/reconciliation.ts` -- wraps body in try/catch; logs `[worker/reconciliation] start`, success counts, and failure trace.
- `src/lib/workers/rate-refresh.ts` -- same start/success/failure logging plus per-corridor failure log.
- `src/components/design/KolaPrimitives.tsx` -- new `<AdminAlert>` primitive (Variant D tokens, `tone='warn'|'error'`, `data-testid="admin-alert"`).
- `src/app/admin/page.tsx` -- renders `<AdminAlert tone="warn">Admin data partially unavailable. Check server logs.</AdminAlert>` when any of the three admin fetches returned null.
- `src/app/(dashboard)/send/page.tsx` -- rate-fetch failure now `setError('Could not load live rate. Please refresh.')` instead of swallowing; clears the same error string on next successful poll.
- `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` -- pass `mockSumsubClient` to 4 `initiateKyc`/`retryKyc` calls (TS2554 fix).
- `tests/lib/transfers/queries.test.ts` -- replace `as Record<string, unknown>` direct casts with `unknown as Record<string, unknown>` two-step (TS2352 fix); add 2 new tests for the user-safe projection contract.
- `tests/app/api/rates/public.test.ts` -- new test "honors admin-override rates" confirming the RateService refactor.
- `tests/app/admin/page.test.tsx` (NEW) -- 2 tests verifying the `AdminAlert` renders on partial-fetch failure and is absent when all three succeed. Uses a tiny tree-walk helper since the project does not depend on React Testing Library.

Decisions:
- `getTransferAdmin()` not added because no admin route currently calls `getTransfer` (admin uses `prisma.transfer` directly). If that changes, add it then.
- `USER_SAFE_TRANSFER_SELECT` is `satisfies Prisma.TransferSelect` so future Transfer columns won't silently leak.
- `getCurrentRateByPair` instantiates a `RateService` per call. Cheap; consolidating into a singleton is in Known Gaps and not in scope here.
- `AdminAlert` uses inline tokens like the rest of `KolaPrimitives.tsx`; no Tailwind classes for the colored surface.
- Send-page `setError` is cleared only when its exact "Please refresh" message is the current value, so user errors from `handleSend` aren't accidentally wiped on the next 60s poll.
- `.next/types/validator.ts` had a stale reference to a deleted `src/app/page.tsx` — deleted the `.next` cache so tsc's clean baseline is reproducible.

Verification:
- `npx tsc --noEmit` -- 0 errors. NO exclusions.
- `npm test -- --run` -- 392 pass / 0 fail (was 387; +5 new tests).
- Targeted: `tests/app/api/rates/public.test.ts` 9/9 pass; `tests/lib/transfers/queries.test.ts` 11/11 pass; `tests/app/admin/page.test.tsx` 2/2 pass.
- Grep confirms zero remaining bare `} catch {` in the touched route/worker files.

Reviewer findings: [pending Richard]
Deploy: pending Step 15 holistic review

---

### Step 14 -- UI→Backend Gap Closure -- REVIEW PENDING
*Date: 2026-04-15*

Closes 3 gaps the Variant D redesign introduced (audit by Bob, scope confirmed by Arch).

Files changed:
- `src/app/api/rates/public/route.ts` (NEW) -- public read-only rate endpoint, pair-based query, 60s/120s SWR cache, no admin field leak
- `tests/app/api/rates/public.test.ts` (NEW) -- 8 cases covering 400, 404, success shape, PII filter, cache header, case normalization
- `src/lib/transfers/queries.ts` -- enrich `listTransfers` with `recipient: { id, fullName, bankName }`; new exported `TransferListRecipient` and `TransferWithRecipient` types
- `tests/lib/transfers/queries.test.ts` -- new test for the recipient enrichment + sensitive-field omission
- `src/app/(dashboard)/send/page.tsx` -- swap `/api/rates/aud-ngn` → `/api/rates/public?base=AUD&target=NGN`
- `src/app/_components/landing-page.tsx` -- same swap + comment update

Decisions:
- Generic pair-based public endpoint (consistent with multi-corridor invariant), not slug-based
- Send page uses the same public endpoint (no separate authed variant in this step)
- `TransferWithRecipient.recipient` typed nullable for safety
- Pre-existing `/api/rates/[corridorId]` left in place; no callers but no harm

Verification:
- `npx tsc --noEmit` -- 0 errors (cleaner than baseline of 4)
- `npm test -- --run` -- ~382 pass, 4 known-flaky failures (matches HANDOVER baseline)
- `tests/app/api/rates/public.test.ts` in isolation -- 8/8 pass

Reviewer findings: [pending Richard]
Deploy: pending Step 15 holistic review

---

### Step 1 -- Project Scaffold + Database Schema -- REVIEW PENDING
*Date: 2026-04-14*

Files changed:
- `.gitignore` -- git ignore rules
- `package.json` -- project config, scripts, dependencies
- `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs` -- Next.js 15 scaffold config
- `vitest.config.ts` -- test runner config
- `prisma.config.ts` -- Prisma 7 config (datasource URL, seed command)
- `prisma/schema.prisma` -- full schema (12 models, 7 enums)
- `prisma/seed.ts` -- AUD-NGN corridor + test rate seed
- `prisma/migrations/20260414042514_init/` -- initial migration
- `src/lib/db/client.ts` -- Prisma client singleton
- `src/lib/{transfers,payments,kyc,auth,rates,compliance}/index.ts` -- placeholder modules
- `tests/lib/db/foundation.test.ts` -- 6 foundation tests
- `.env` -- local DATABASE_URL (port 5433)

Decisions made:
- Prisma 7.7.0 requires adapter-based client (PrismaPg from @prisma/adapter-pg) instead of classic PrismaClient
- Docker Postgres on port 5433 (5432 occupied by existing porizo-postgres container)
- Generated Prisma client gitignored, regenerated via postinstall hook
- Used `prisma-client` generator (Prisma 7 default) instead of deprecated `prisma-client-js`

Reviewer findings: [pending review]
Deploy: N/A

---

### Step 9 -- API Routes + Pages (Full Stack) -- REVIEW PENDING
*Date: 2026-04-14*

Files changed:
- `src/lib/auth/middleware.ts` -- auth middleware (cookie parsing, session validation, requireAuth/requireKyc)
- `src/app/api/auth/{register,login,logout,verify-2fa}/route.ts` -- auth API routes
- `src/app/api/transfers/route.ts`, `[id]/route.ts`, `[id]/cancel/route.ts` -- transfer CRUD + cancel
- `src/app/api/recipients/route.ts`, `[id]/route.ts` -- recipient CRUD + delete
- `src/app/api/webhooks/{monoova,flutterwave,paystack,sumsub}/route.ts` -- webhook handlers (raw body)
- `src/app/api/kyc/{initiate,status}/route.ts` -- KYC endpoints
- `src/app/api/rates/[corridorId]/route.ts` -- public rate endpoint
- `src/app/(auth)/layout.tsx`, `login/page.tsx`, `register/page.tsx` -- auth pages
- `src/app/(dashboard)/layout.tsx`, `_components/bottom-nav.tsx` -- dashboard shell
- `src/app/(dashboard)/{send,activity,recipients,account}/page.tsx` -- 4 dashboard pages
- `src/app/globals.css` -- Kolaleaf theme colors (purple-to-green gradient)
- `src/app/layout.tsx`, `src/app/page.tsx` -- branding + redirect to /send
- `tests/lib/auth/middleware.test.ts` -- 7 auth middleware tests
- `tests/app/api/auth/{register,login}.test.ts` -- 11 auth route tests
- `tests/app/api/webhooks/monoova.test.ts` -- 4 webhook tests
- `tests/app/api/rates/corridor.test.ts` -- 2 rate tests
- All `src/lib/**/*.ts` -- stripped .js import extensions for Turbopack compatibility
- `src/lib/payments/payout/webhooks.ts`, `flutterwave.ts` -- type fixes for Prisma Json + unknown
- `src/lib/transfers/state-machine.ts` -- metadata cast for Prisma Json type

Decisions made:
- Custom cookie-based auth (kolaleaf_session, HttpOnly, SameSite=Lax, Max-Age=900)
- Webhook routes use request.text() for raw body signature verification
- Dashboard layout does server-side session check, redirects to /login if unauthenticated
- Send page polls rates every 60s with Decimal.js math
- Cleaned .js extensions from all TS imports (Turbopack doesn't resolve .ts → .js)

Reviewer findings: [pending review]
Deploy: N/A

---

## Known Gaps
*Logged here instead of fixed. Addressed in a future step.*

Logged during Step 14 audit (deferred per brief):
- `/activity/[id]` -- transfer detail page referenced by Activity row links, not yet implemented
- `/privacy`, `/terms`, `/compliance-info` -- footer stub links (404 today)
- Mobile hamburger menu in `SiteHeader` (current mobile fallback is "Sign in / Start sending" only)
- Login rate limiting (no protection against brute force)
- Account page user name/email display (not requested in any brief; nice-to-have)
- Test flakiness in `tests/lib/transfers/queries.test.ts` (4 tests fail under `afterEach` cleanup race; pre-existing, not introduced by Step 14)
- Pre-existing `/api/rates/[corridorId]` route is now unused by any UI -- remove in a future cleanup step
- 4 pre-existing TS errors in `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` (runtime-safe per HANDOVER) -- now showing as 0 in tsc, may need re-check

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Prisma 7 with adapter pattern (PrismaPg) for database connectivity -- 2026-04-14
- cuid() for all primary keys (URL-safe, sortable) -- 2026-04-14
- @db.Decimal for all money amounts, never float -- 2026-04-14
- Cascade delete on UserIdentifier and Session only; no cascade on Transfer or Recipient -- 2026-04-14
- @@unique([baseCurrency, targetCurrency]) on Corridor for multi-corridor support -- 2026-04-14
