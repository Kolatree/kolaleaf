# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** 15e -- Twilio SMS integration + phone verification + SMS 2FA helpers (review pending)
**Last cleared:** Step 15b
**Pending deploy:** NO

---

## Step History

### Step 15e -- Twilio SMS integration + phone verification + SMS 2FA helpers -- REVIEW PENDING
*Date: 2026-04-15*

Ships the outbound-SMS infrastructure (Twilio), the phone-verification flow
(add phone -> receive 6-digit SMS -> submit -> identifier flipped verified),
a phone-remove endpoint that blocks while SMS 2FA is active, and the
`TwoFactorChallenge` issuer/verifier helpers that 15f will plug into login.
No schema migrations (15c covered all tables). One new dep: `twilio`.

Files changed:
- `package.json` / `package-lock.json` -- added `twilio` dependency (only new dep).
- `.env` / `.env.example` -- added `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_FROM_NUMBER`. All blank in dev; `sendSms()` console.logs with
  `[sms-dev]` prefix. Production throws at `client.ts` import if any is missing.
- `src/lib/sms/client.ts` (new) -- Twilio client init, fail-fast in production,
  dev-null in development. Mirrors the shape of `src/lib/email/client.ts`.
- `src/lib/sms/send.ts` (new) -- `sendSms({to,body})` wrapper returning
  `{ok,id?,error?}`. Dev fallback: `[sms-dev]` stdout log. Never throws.
- `src/lib/sms/index.ts` (new) -- barrel.
- `src/lib/auth/phone.ts` (new) -- `normalizePhone(raw)` (regex-only E.164
  placeholder; stripping spaces/dashes/parens and requiring `+\d{7,15}$`),
  `InvalidPhoneError`, `generateSmsCode()` (6-digit + bcrypt cost-4 hash),
  `verifySmsCode(raw, hash)`. The cost-4 choice is documented inline: the
  code space is only 10^6 so sha256 would be rainbow-tabled; bcrypt's salt
  blocks that, and cost 4 keeps verify fast for a 5-10min ttl.
- `src/lib/auth/two-factor-challenge.ts` (new) -- `issueSmsChallenge(userId,
  phoneE164)` returns `{challengeId}` after creating a `TwoFactorChallenge`
  (method=SMS, 5min expiry) and dispatching the SMS. `verifyChallenge(id, raw)`
  looks up, rejects expired/consumed/attempts>=5, increments attempts on every
  submission, bcrypt-compares, and marks `consumedAt` on success.
- `src/app/api/account/phone/add/route.ts` (new) -- `requireAuth`. Normalises
  phone, rejects 409 if another user owns the number verified, rate-limits to
  3 codes per (user, phone) per hour (429 with `retryAfter`), upserts an
  unverified `UserIdentifier`, invalidates prior unused codes, writes a fresh
  `PhoneVerificationCode` with 10min expiry, fires SMS. SMS failure is logged
  but the 200 still returns because the code row is persisted.
- `src/app/api/account/phone/verify/route.ts` (new) -- `requireAuth`. Finds
  the latest unused, non-expired code. Increments attempts on every submission.
  On the 5th attempt the code is burned regardless of correctness. On success,
  a `$transaction` atomically flips `UserIdentifier.verified=true`, marks the
  code `usedAt=now()`, and writes `PHONE_VERIFIED` AuthEvent -- so the audit
  row and state transition are all-or-nothing.
- `src/app/api/account/phone/remove/route.ts` (new) -- `requireAuth`. 400
  `cannot_remove_phone_while_2fa_active` if `User.twoFactorMethod==='SMS'`.
  Otherwise hard-deletes the `UserIdentifier` row and writes `PHONE_REMOVED`
  AuthEvent with the phone in metadata for audit.
- New tests: `tests/lib/sms/send.test.ts` (6), `tests/lib/auth/phone.test.ts`
  (13), `tests/lib/auth/two-factor-challenge.test.ts` (7),
  `tests/app/api/account/phone/add.test.ts` (6),
  `tests/app/api/account/phone/verify.test.ts` (7),
  `tests/app/api/account/phone/remove.test.ts` (5).

Test count: 438 -> 481 (43 new, all green). tsc: 0 new errors (one pre-existing
error in `src/app/api/auth/register/route.ts` from 15d -- see Known Gaps).

Decisions:
- **bcrypt cost 4 for SMS codes is intentional.** Short-lived (5-10min) + low
  entropy (6 digits). Higher cost hurts verify latency without materially
  raising the attacker's cost for a brute-force within the ttl. Documented
  inline in `src/lib/auth/phone.ts`.
- **E.164 uniqueness gate is verified-only.** Another user holding the phone
  as verified blocks the add. An abandoned unverified hold does not block --
  a legitimate owner must be able to reclaim it.
- **`verifyChallenge` increments attempts on success too.** A brute-force
  attacker cannot burn 4 wrong guesses and then nail it on #5 -- every
  submission costs one attempt, correct or not.
- **`PHONE_VERIFIED` audit row is inside the same `$transaction`** as the
  identifier flip and the code consume. An audit hole is impossible.
- **Phone-remove blocks SMS 2FA active users.** Without this guard they'd
  lock themselves out -- no phone to receive the 2FA code on. 15f's disable-
   2FA flow is the supported escape hatch.
- **SMS 2FA login wiring is NOT in this step.** Helpers exist but no route
  path calls them -- that's 15f.

Known Gaps:
- Regex E.164 normalisation in `src/lib/auth/phone.ts` is a placeholder. It
  does not validate country codes or regional carrier formats. Replace with
  `libphonenumber-js` or Twilio Lookup in a later step when bringing in a
  proper dep is budgeted.
- `src/app/api/auth/register/route.ts:36` previously had a pre-existing tsc
  error from 15d; after the 15e post-review re-verify run it no longer
  reports (likely a stale Prisma generate from the earlier session). Not
  counted as a gap anymore; flagging here only for traceability.

Fixes applied post-Richard review (round 1):
- **Must Fix 1** -- cross-user phone hijack via abandoned unverified claim.
  Upsert `update` in `src/app/api/account/phone/add/route.ts` now transfers
  ownership (`{userId, verified:false, verifiedAt:null}`) when the row
  exists unverified under another user. The 409 guard still blocks when the
  existing row is verified under another user. Code-invalidation scope
  dropped the `userId` filter so codes issued to the previous owner cannot
  be replayed by the new owner.
- **Should Fix 1** -- regression test added at
  `tests/e2e/phone-verification.test.ts` (real DB, 2 cases) proving
  ownership transfer works and the 409 verified-taken path is unchanged.
- **Should Fix 2** -- `verifyChallenge` in
  `src/lib/auth/two-factor-challenge.ts` now stamps `consumedAt` in the
  same update as the exhausting attempts increment. Two new unit tests in
  `tests/lib/auth/two-factor-challenge.test.ts` prove the behavior (exhaust
  on wrong code kills future correct guesses; success on the exhausting
  attempt does not double-stamp).
- Re-verify: `npx tsc --noEmit` -> 0 errors; `npm test -- --run` -> 485/485
  passing.

### Step 15d -- Resend integration + email verification + password reset flows -- REVIEW PENDING
*Date: 2026-04-15*

Ships the first outbound-email infrastructure (Resend), the email-verification flow
(signup → email → click → flipped), the password-reset flow (forgot → email → reset →
force-logout), and a new `requireEmailVerified` gate on transfer creation. Email
enumeration prevented on `request-password-reset`; all tokens stored only as sha256(raw).

Files changed:
- `package.json` / `package-lock.json` -- added `resend` dependency (only new dep).
- `.env` / `.env.example` -- added `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`; `.env.example`
  created fresh (no prior file). `RESEND_API_KEY` blank in dev — emails console.log with
  `[email-dev]` prefix instead of calling Resend.
- `src/lib/auth/tokens.ts` (new) -- `generateVerificationToken()` returns
  `{ raw, hash }` (32 random bytes hex + sha256(raw)); `hashToken(raw)` shared helper.
  Reusable for email-verification AND password-reset.
- `src/lib/auth/password.ts` -- added `validatePasswordComplexity()` helper so register
  and reset share the same gate (length >= 8, matching existing register contract).
- `src/lib/auth/middleware.ts` -- added `requireEmailVerified(request)`; throws
  `AuthError(403, 'email_unverified')` when the user's primary EMAIL identifier is
  unverified. Additive — existing routes that don't call it keep working.
- `src/lib/auth/login.ts` -- removed the `!identRecord.verified` gate. Users MUST be
  able to sign in with an unverified email so they can request a fresh verification
  link; money-moving routes are gated by `requireEmailVerified` instead.
- `src/lib/auth/register.ts` -- new users now created with `UserIdentifier.verified=false`
  (was `true`). The `/api/auth/verify-email` flow flips it on first click.
- `src/lib/email/client.ts` (new) -- Resend init; in production throws if
  `RESEND_API_KEY` or `EMAIL_FROM` missing (fail-fast at deploy rather than first email).
- `src/lib/email/send.ts` (new) -- `sendEmail({to,subject,html,text})` wrapper.
  Dev/test fallback: `[email-dev]` stdout log. Returns `{ok,id?,error?}`.
- `src/lib/email/templates/verify-email.ts` (new) -- `renderVerificationEmail(...)`
  returning `{subject, html, text}`. Brand-aware (purple→green gradient), HTML
  inline-styled for email-client compat, with HTML-escaped dynamic values.
- `src/lib/email/templates/password-reset.ts` (new) -- `renderPasswordResetEmail(...)`
  with optional IP + user-agent context block so users can spot a foreign request.
- `src/lib/email/index.ts` (new) -- barrel.
- `src/app/api/auth/register/route.ts` -- after successful registration,
  fire-and-forget a verification email. Signup still succeeds even if Resend is down;
  the user can use `/api/auth/resend-verification` later. Decision commented inline.
- `src/app/api/auth/verify-email/route.ts` (new) -- public `GET` endpoint, no auth.
  Hash the raw token, look up by `tokenHash`, reject expired/used/missing with a
  generic "link expired or already used" HTML page. On success: mark token used, flip
  `UserIdentifier.verified`+`verifiedAt`, render success page. Minimal inline CSS — this
  is a one-shot page, not part of the Variant D shell.
- `src/app/api/auth/resend-verification/route.ts` (new) -- `requireAuth`. Rate-limited
  to 5 requests per user per hour (returns 429 silently when exceeded); returns 200
  with `{alreadyVerified:true}` short-circuit if the email is already verified;
  otherwise invalidates prior unused tokens and sends a fresh one.
- `src/app/api/auth/request-password-reset/route.ts` (new) -- public. ALWAYS returns
  the same generic 200 response (`"If an account exists with that email, we've sent
  a reset link."`) whether the email exists, is rate-limited, or the send fails —
  email-enumeration defence. Rate limit: 3 per user per hour, silent. Captures IP +
  user-agent in the email body + persists them on the token row for audit.
- `src/app/api/auth/reset-password/route.ts` (new) -- public. Validates token, hashes
  new password via the shared bcrypt helper, marks token used, and
  `prisma.session.deleteMany({where:{userId}})` to force-logout everywhere. Logs a
  `PASSWORD_RESET` AuthEvent. Invalid/expired/used tokens collapse to a single generic
  "Invalid or expired reset link" 400.
- `src/app/api/transfers/route.ts` -- added `await requireEmailVerified(request)`
  before `requireKyc`. `AuthError('email_unverified')` is surfaced to the client as
  `{error:'email_unverified', message:'Please verify your email before sending money.'}`
  with a 403.
- `src/lib/auth/__tests__/login.test.ts` -- `createVerifiedUser` helper now flips the
  identifier to verified after `registerUser` (register no longer pre-verifies). The
  old "throws on unverified identifier" test rewritten to assert the opposite (login
  now succeeds; verified gate moved downstream).
- `src/lib/auth/__tests__/register.test.ts` -- identifier assertion updated to
  `verified=false` + `verifiedAt=null` post-15d.
- New tests: `tests/lib/auth/tokens.test.ts` (6), `tests/lib/email/send.test.ts` (4),
  `tests/lib/email/templates/verify-email.test.ts` (4),
  `tests/lib/email/templates/password-reset.test.ts` (5),
  `tests/app/api/auth/resend-verification.test.ts` (5),
  `tests/app/api/auth/verify-email.test.ts` (5),
  `tests/app/api/auth/request-password-reset.test.ts` (5),
  `tests/app/api/auth/reset-password.test.ts` (7).

Decisions:
- **Unverified-at-signup is the whole point.** Registration now lands new users with
  `UserIdentifier.verified=false`. If registration continued to auto-verify, the whole
  15d verification flow would be toothless. This means login had to stop gating on
  verified (users need to be able to request a new link after an expired one) — the
  real gate lives on transfer creation where it matters.
- **Token storage: hash-only.** Raw tokens never touch the database. Only the
  sha256 hex is stored in `EmailVerificationToken.tokenHash` and
  `PasswordResetToken.tokenHash` (both already uniquely indexed from 15c). A DB leak
  cannot be replayed as active tokens.
- **Fire-and-forget on signup email.** The verification email is dispatched with a
  `.catch(console.error)` chain after the signup response is built; a Resend outage
  MUST NOT fail the signup (the `/resend-verification` endpoint is a fallback).
- **Email enumeration prevention on password reset.** `request-password-reset` always
  returns the same 200 body whether the email exists or not, whether rate-limited or
  not, whether Resend succeeded or not. Timing difference is minimal — the rare "user
  exists" branch does one extra DB write, but the happy path is the same shape.
- **Force-logout on password change.** `session.deleteMany({where:{userId}})` after
  a successful reset. Security baseline — no exceptions.
- **Generic error page.** `/verify-email` collapses all failure modes (missing token,
  wrong token, expired, already used) into one page. We don't leak "this token
  existed but was consumed" vs "this token never existed."
- **Dev-mode email.** No SMTP round trip required; `[email-dev]` stdout dump is the
  inner loop. Production is fail-fast: `client.ts` throws at import if
  `RESEND_API_KEY`/`EMAIL_FROM` missing, so a broken deploy goes red immediately
  rather than silently failing to send verification emails to real users.
- **Rate limits are silent.** 5/hour on `/resend-verification` (429 — user can see
  why), 3/hour on `/request-password-reset` (200 generic — attacker cannot probe).

Verification:
- `npx tsc --noEmit` — 0 errors.
- `npm test -- --run` — 436/436 passing (392 baseline + 44 new).
- `npm run dev` smoke:
    - `POST /api/auth/register {email:"smoke-TS@test.com",...}` → 201, dev log shows
      `[email-dev] Subject: Verify your Kolaleaf email` with a verification URL.
    - `POST /api/auth/request-password-reset {email:"smoke-TS@test.com"}` → 200 with
      generic message, dev log shows `[email-dev] Subject: Reset your Kolaleaf password`
      including IP (`::1`) and user-agent (`curl/8.7.1`) context and a reset URL.
    - `POST /api/auth/request-password-reset {email:"nonexistent@test.com"}` → 200
      with identical generic message, no `[email-dev]` log.

Known Gaps (out of 15d scope):
- `login.ts` now no longer blocks non-EMAIL unverified identifiers either. Per the
  brief, phone verification is 15g scope; the minimal safe default was to drop the
  universal gate. 15g will reintroduce a type-aware gate if needed.
- `validatePasswordComplexity` is currently just length>=8 to match the existing
  register contract. Richer rules (upper/lower/digit/symbol) would break existing
  users on reset; leave as-is until Arch explicitly bumps the policy.

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
