# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** Pile B COMPLETE (Steps 19-25 all landed locally). Awaiting push.
**Last cleared:** Step 24 -- observability foundation (24c9657)
**Pending deploy:** 8 local commits on top of 6d3db06 (the pushed Step 19). Arch pushes when ready.
**Tests:** 827 passing (baseline 706 + 121 new). tsc clean. build clean.

### Pile B commit ledger

| Step | Hash | Title | State |
|---|---|---|---|
| 19 | 6d3db06 | /api/v1 versioning — 42 routes moved | **pushed** + Railway auto-deployed |
| 20a | 3cc886f | Zod + OpenAPI — tooling + 5 pilot routes | local |
| 20b | ae9b6a4 | Zod schemas for remaining 36 routes + barrel | local |
| 20c | e3911de | Richard's Step 20 review feedback | local |
| 22 | 47d9c84 | User.state → Postgres AuState enum | local |
| 23 | 89ad06e | BullMQ email queue with FailedEmail sink | local |
| 25 | 408fa2b | soft-delete User rows (Option B) + cleanup script | local |
| 21 | 3333e08 | discriminated-union identifier body on /auth/login | local |
| 24 | 24c9657 | observability foundation — pino + request ID + /api/health + alert sinks | local |

### Pre-push checklist for Arch

- [ ] Run `SELECT DISTINCT state FROM "User"` against prod — confirm only enum-legal values or NULL before Step 22's migration runs
- [ ] Confirm prod `REDIS_URL` is set (Step 23's email worker + Step 24's /api/health redis check)
- [ ] Optional dry-run: `pnpm tsx scripts/cleanup-legacy-users.ts` against a prod snapshot to preview candidate list before running `--apply`
- [ ] First push: `git push origin main` — Railway runs `prisma migrate deploy` (3 new migrations: user_state_enum, failed_email, user_soft_delete) during release phase

---

## Step History

### Step 19 -- /api/v1 versioning -- APPROVED (deploy pending)
*Date: 2026-04-17*

Every client-facing API route moved under `/api/v1/`. All in-repo callers
rewired through a new single-source HTTP client `apiFetch`. Webhooks (4
routes) and cron (5 routes) stay at legacy `/api/*` paths because their
URLs are registered off-platform (providers + Railway cron). The
`/api/auth/register` 410-Gone stub is preserved at its legacy path with
its migration hint updated to point at `/api/v1/*` successors.

This is the foundation for Steps 20-25 of Pile B -- each of those
assumes a versioned surface.

Files added (3):
- `src/lib/http/api-client.ts` -- `API_V1 = '/api/v1'` + `apiFetch(path, init)` wrapping `fetchWithTimeout`. 17 lines.
- `tests/lib/http/api-client.test.ts` -- 4 unit tests (prefix, leading-slash tolerance, method/headers/body passthrough, timeout abort).
- `tests/e2e/versioning-smoke.test.ts` -- 4 smoke tests (v1 200, legacy 404, register 410, webhook still at legacy path).

Files moved (42 routes + 22 paired tests):
- `src/app/api/{auth,account,admin,transfers,recipients,rates,kyc,banks}/*` -> `src/app/api/v1/{same}/*` (41 routes under v1).
- `tests/app/api/<area>/*` -> `tests/app/api/v1/<area>/*` for moved areas.
- `/api/auth/register` 410 stub restored at legacy path after the initial auth rename.

Files modified (18):
- `src/lib/hooks/use-wizard-submit.ts` -- swapped `fetchWithTimeout` for `apiFetch`.
- 5 wizard pages, 8 dashboard pages/components, 4 admin pages -- all call sites updated to `apiFetch('area/path', ...)` tail paths.
- `fetchAdminJson` in `src/app/admin/page.tsx` -- sources prefix from exported `API_V1`, preserves RSC absolute-URL + cookie-forwarding pattern.
- 3 test files patched for string URLs (`tests/app/admin/page.test.tsx`, `tests/e2e/register-wizard.test.ts`, `tests/e2e/phone-verification.test.ts`, `tests/security/admin-security.test.ts`).

Files deleted: none.

Review findings applied (N1+N2 from Richard):
- 410 stub migration hint updated: `/api/auth/send-code` -> `/api/v1/auth/send-code` in both the JSON `migrate_to` field, the `Link` response header, and the prose `error` field. Stale clients parsing the hint now land on the live endpoint instead of a 404.
- Comment-only legacy path references refreshed in `account-identity-section.tsx:11` and `register/details/page.tsx:21`.

Decisions made (not explicit in brief):
- `fetchAdminJson` kept as RSC-side wrapper over raw `fetch` (not `apiFetch`). Relative URLs don't resolve in server components; absolute-URL + cookie-forwarding pattern preserved. Prefix sourced from exported `API_V1` constant so "one prefix, one source" still holds.
- Versioning smoke test uses `await import(variable)` to defer module resolution to runtime -- static `import()` of a deleted module would fail type-check; the runtime rejection is what the test asserts.

Verification:
- `npm test -- --run` -- 706 passed / 0 failed (baseline 698 + 4 api-client unit + 4 versioning smoke).
- `npx tsc --noEmit` -- 0 errors.
- `rm -rf .next && npm run build` -- success, 41 `/api/v1/*` routes + 4 webhooks + 5 crons + 1 `/api/auth/register` 410 stub all listed.
- Local curl smoke: `/api/v1/auth/send-code` -> 200, `/api/auth/login` -> 404, `/api/auth/register` -> 410, `/api/webhooks/monoova` -> 405. All match brief.
- Grep evidence: zero `fetch("/api/[^v]` call sites in src/app or tests; the only non-v1 `/api/` string in src/app is the (intentional) migration hint in the 410 stub.

Reviewer findings: Richard APPROVE with 2 non-blocking nits. Both applied before deploy.
Deploy: pending Arch -- no migration, rollback is a single-commit revert.

---

### Step 18 -- Verify-first registration (3-step wizard) -- REVIEW PENDING
*Date: 2026-04-17*

Replaces the one-shot /register with a three-step wizard that creates NO User
row until the email has been verified AND the claim is completed. Eliminates
the "ghost unverified user" class of rows from the DB and tightens the
AUSTRAC posture: every persisted customer provably controlled their email at
the moment of account creation. Per Product Owner: "so we don't fill the
database with unverified emails."

Files added:
- `prisma/migrations/20260417035232_pending_email_verification_and_address/migration.sql` -- new `PendingEmailVerification` table + nullable AU address columns on `User`
- `src/lib/auth/pending-email-verification.ts` -- `issuePendingEmailCode` + `verifyPendingEmailCode` helpers (modelled on `email-verification.ts`, adapted for rows keyed by email instead of userId since no User exists yet)
- `src/app/api/auth/send-code/route.ts` -- step 1 endpoint, always 200 (enumeration-proof)
- `src/app/api/auth/verify-code/route.ts` -- step 2 endpoint, opens 30-min claim window, NEVER sets a session
- `src/app/api/auth/complete-registration/route.ts` -- step 3 endpoint, transactional create of User + verified UserIdentifier + Session + REGISTRATION + LOGIN AuthEvents, deletes PendingEmailVerification
- `src/app/(auth)/register/verify/page.tsx` -- step 2 page (6-digit input, resend)
- `src/app/(auth)/register/details/page.tsx` -- step 3 page (name + AU address + password)
- `src/app/(dashboard)/kyc/page.tsx` -- post-registration KYC prompt (Verify / Skip)
- `tests/lib/auth/pending-email-verification.test.ts` -- 12 unit tests for the new helper (rate limit, hash-at-rest, idempotent-verify, all error reasons)
- `tests/app/api/auth/send-code.test.ts` -- 8 route tests
- `tests/app/api/auth/verify-code.test.ts` -- 10 route tests
- `tests/app/api/auth/complete-registration.test.ts` -- 14 route tests (validation, 409 race, full tx success path)
- `tests/e2e/register-wizard.test.ts` -- 3 e2e tests against the real DB

Files modified:
- `prisma/schema.prisma` -- new `PendingEmailVerification` model; new nullable fields on `User` (addressLine1, addressLine2, city, state, postcode, country)
- `src/app/(auth)/register/page.tsx` -- rewritten: email-only form that calls `/api/auth/send-code` and bounces to `/register/verify`

Files deleted:
- `src/app/api/auth/register/route.ts` -- legacy monolithic register handler (404 in prod, confirmed via curl)
- `tests/app/api/auth/register.test.ts` -- paired tests (7 cases)

Decisions made (that weren't explicitly called out in the brief):
- Pending row keyed by email (unique). Upsert on re-send wipes attempts + verifiedAt + claimExpiresAt — resend always restarts the clock cleanly. Alternative was to keep each issue as a separate row with "most recent wins"; the upsert model matches the brief's natural "one pending row per email" mental model and avoids needing cleanup jobs for stale-but-unused rows.
- `PendingEmailVerification` has no `usedAt` column. Burning a token after the Nth wrong attempt is done by setting `expiresAt = now - 1ms`. A cleaner-looking alternative would be adding a `usedAt` column, but the row is deleted by /complete-registration within minutes anyway — the expiry-based burn keeps the schema smaller and still blocks further guesses.
- Re-verify within the claim window returns `ok: true` rather than `used`. This makes the UX robust to back-button reloads on step 3 that re-fire step 2 — a common React wizard trap — without needing a "verified but not claimed" branch in the route.
- The verification email for the wizard uses `recipientName: "there"` because no User row exists yet and we cannot leak user-supplied strings into the subject without an injection guard. "there" keeps the copy warm without that risk.
- `/kyc` placed in the `(dashboard)` group so the existing server-side auth gate redirects unauthenticated users to `/login`. Matches the brief: the user has a session after step 3 and the page is authenticated. The page renders its own full-screen gradient (no bottom nav) because KYC is a one-off intercept, not a nav-bar destination.
- `complete-registration` does a soft cleanup: if a stale UNverified UserIdentifier exists for the same email (edge case from pre-wizard legacy test data), delete it before re-creating as verified. Verified duplicates still throw 409.
- Session cookie is set by `setSessionCookie(session.token)` -- reused from the existing middleware so the cookie lifetime policy stays in one place.

Verification:
- `npm test -- --run` -- 695 passed / 0 failed (baseline 655 + 44 new + 3 e2e -- 7 deleted legacy = 695)
- `npx tsc --noEmit` -- 0 errors
- `rm -rf .next && npm run build` -- success, all new routes present (`/register`, `/register/verify`, `/register/details`, `/kyc`, `/api/auth/send-code`, `/api/auth/verify-code`, `/api/auth/complete-registration`)
- Local curl smoke path: send-code (200) -> verify-code (200 verified, no cookie) -> complete-registration (201 + Set-Cookie) -> GET /api/account/me (200 user w/ address verified) -> /api/auth/register (404)
- DB inspection after smoke: User row with address + country=AU, UserIdentifier verified=true, PendingEmailVerification row deleted, AuthEvents = [REGISTRATION, LOGIN]

Reviewer findings: [pending Richard]
Deploy: pending Arch -- migration is backfill-safe (all new User columns nullable, new table with no FK to User)

---

### Step 16 -- Flutterwave bank resolution for recipients UX -- REVIEW PENDING
*Date: 2026-04-16*

Replaces the free-text recipient form with a provider-verified flow: pick a
bank from Flutterwave's bank list, type a 10-digit account number, and the
account holder's canonical name is resolved via `/accounts/resolve`. Matches
the Nigerian remittance UX standard (every prod NG fintech works this way)
and removes the "typo in account name" failure mode that eats payouts.

Files changed:
- `src/lib/payments/payout/types.ts` -- Added `AccountNotFoundError` (non-
  retryable `PayoutError` subclass). Callers distinguish "invalid combo" from
  transient provider errors.
- `src/lib/payments/payout/flutterwave.ts` -- Added exported `NG_BANKS_FALLBACK`
  (21 tier-1 + mobile-money banks). Added `listBanks(country: 'NG')` — dev
  returns the fallback list with a one-shot log, prod GETs `/v3/banks/NG` via
  `withRetry` and memos for 24h. Added `resolveAccount({bankCode,
  accountNumber})` — dev returns `DEMO ACCOUNT <last4>` deterministically,
  prod POSTs `/v3/accounts/resolve` with SHA-256 Idempotency-Key of
  `bankCode:accountNumber`. Account name returned verbatim (no trim/case).
  Added `createFlutterwaveProvider()` lazy factory — reads env each call,
  never throws at import time. Matches the 15l lazy-env pattern.
- `src/lib/payments/payout/index.ts` -- Exports the new error, factory,
  fallback list, and `BankListEntry` type.
- `src/app/api/banks/route.ts` (new) -- `GET /api/banks?country=NG`.
  `requireAuth`; rejects unsupported country with 400; returns `{ banks }`
  with `Cache-Control: private, max-age=3600`; 503 on provider failure.
- `src/app/api/recipients/resolve/route.ts` (new) -- `POST /api/recipients/
  resolve`. `requireAuth`; validates `bankCode` non-empty and `accountNumber`
  exactly 10 digits; in-memory per-user rate-limit (20/min); returns `{
  accountName }` on success, 404 `account_not_found` on AccountNotFoundError,
  503 `resolve_unavailable` on provider temp/timeout/retryable errors.
- `src/app/(dashboard)/recipients/page.tsx` -- Replaced 4 free-text inputs
  with (1) bank dropdown loaded from `/api/banks?country=NG` on mount, (2)
  10-digit-only account number input (`\D` stripped, maxLength 10), (3)
  debounced 400ms resolve with out-of-order `resolveSeqRef` guard and live
  state display (loading / resolved / not_found / unavailable), (4) submit
  button disabled until `resolveState.kind === 'resolved'`. Client sends the
  resolved name to the unchanged `POST /api/recipients` contract.

Tests added (+21, baseline 607 -> 628):
- `tests/lib/payments/payout/flutterwave-resolve.test.ts` (+10) -- listBanks
  dev fallback no-network, prod fetch + normalise, 24h cache; resolveAccount
  dev stub determinism, prod body + Idempotency-Key hash, literal name
  preservation, AccountNotFoundError on provider error / missing field.
- `tests/app/api/banks/route.test.ts` (+5) -- 401, 400 missing country, 400
  unsupported country, 200 + Cache-Control header + banks array, 503 on
  provider failure.
- `tests/app/api/recipients/resolve.test.ts` (+6 containing 7 `expect`-
  groups) -- invalid JSON/body/account-length 400s, 401, 200 with
  accountName, 404 AccountNotFoundError, 503 ProviderTemporaryError, 429
  per-user rate-limit threshold.

Key decisions:
- Lazy env validation matches 15l: `createFlutterwaveProvider()` reads env
  every call but the `FlutterwaveProvider` constructor is side-effect-free
  and never throws. `npm run build` stays green without prod secrets.
- In-memory rate-limit map in the resolve route (noted in the file header as
  swap-for-shared-limiter-later). Scope per userId, 20 req / 60s rolling
  window. Protects against account-number probing without adding Redis.
- Submit button is **disabled** until resolved (not just warning-style) so
  an unverified recipient cannot slip through even with rapid clicks.
- Account name returned verbatim from provider — tested with whitespace-
  padded input so a future "cleanup" refactor can't silently regress.
- `POST /api/recipients` contract unchanged. The existing route, its tests,
  and the server-side validation still expect `{fullName, bankName, bankCode,
  accountNumber}`. The client now fills all four from verified sources.

Manual smoke: DEFERRED. No `.env.local` in this workspace so the dev server
can't reach Postgres. The 21 unit/integration tests exercise all branches
(auth gate, validation, success, not-found, temporary-failure, rate-limit,
bank-cache, idempotency-key shape). Richard may run the dev server himself
with env wired — or punt smoke to QA gate after review.

Known gaps (not in scope for 16):
- `<select>` is a native dropdown. A searchable combobox (21 banks is fine
  for NG but AU/KE/GH corridors will have 40+) is a polish step for a later
  multi-corridor sprint.
- Observability: the posttool validator flagged "no logging on route
  handlers". Consistent across the codebase — will be wired when Sentry /
  structured-logger lands project-wide.
- Rate-limit is in-memory (single-process). Fine for single-Railway-worker
  today; swap to Redis-backed limiter when we scale horizontally.
- The in-memory rateLimitMap in `/api/recipients/resolve` has no eviction.
  Grows unbounded on a long-lived worker as new userIds appear. Low-impact
  (each entry is ~100 bytes) but should be either TTL-swept or replaced
  with a Redis-backed limiter when the Redis limiter above lands.

Post-review fixes applied (per Richard's Step 16 Should-Fix):
- `flutterwave.ts` resolveAccount catch narrowed: only `ProviderPermanentError`
  and generic `PayoutError` (exact class, not subclasses) with
  `retryable=false` map to `AccountNotFoundError`. Future non-retryable
  `PayoutError` subclasses (InvalidBankError, InsufficientBalanceError, etc.)
  now bubble unchanged instead of being silently reclassified.
- `flutterwave.ts` resolveAccount normalises `bankCode` / `accountNumber` via
  `.trim()` BEFORE computing the idempotency-key hash, so whitespace-padded
  and pre-trimmed inputs produce the same key.
- `devListBanksLogged` flag annotated as intentionally module-scoped.
- The rateLimitMap unbounded-growth concern kept in Known Gaps above.

Phase D:
- `npx tsc --noEmit` -> clean
- `npx vitest run` -> 628 passed / 244 suites / 0 failed
- `npm run build` -> `Compiled successfully`, 0 warnings, new routes
  `/api/banks` and `/api/recipients/resolve` registered

---

### Step 15l -- Final wholistic audit + fix pass (capstone) -- REVIEW PENDING
*Date: 2026-04-16*

Capstone pass over the completed web app + admin + auth surface. Phase A
audit walked all 12 prior checkpoints end-to-end (not just the 15k delta).
Phase B fixed the single Critical (build-time env validation) + the one
Major (deprecation comment locked by Step 15 Phase B). Everything else
logged to Known Gaps.

Phase A findings: 1 Critical, 4 Major, 6 Minor, 4 categories verified Clean.
Full findings in `handoff/ARCHITECT-BRIEF.md` under "Phase A Findings -- Step 15l".

Files changed:
- `src/lib/rates/fx-fetcher.ts` -- removed top-level `export const fxConfig =
  validateFxConfig()`. `DefaultFxRateProvider` now resolves config lazily on
  first `fetchWholesaleRate` call via a new `getConfig()` helper. Constructor
  stores the explicit config (if any) without validating -- construction is
  side-effect-free. Import is side-effect-free. Header comment updated to
  document the lazy contract.
- `src/lib/rates/index.ts` -- dropped the now-gone `fxConfig` re-export.
- `src/lib/payments/monoova/client.ts` -- removed top-level `export const
  monoovaConfig = validateMonoovaConfig()`. `createMonoovaClient()` now calls
  `validateMonoovaConfig()` on invocation (first-use). Header comment updated.
- `src/lib/payments/monoova/index.ts` -- dropped `monoovaConfig` re-export.
- `src/lib/kyc/sumsub/client.ts` -- removed top-level `export const sumsubConfig
  = validateSumsubConfig()`. `createSumsubClient()` now validates on
  invocation.
- `src/lib/kyc/sumsub/index.ts` -- dropped `sumsubConfig` re-export.
- `src/lib/email/client.ts` -- top-level `if (isProduction) throw` replaced
  with exported `assertResendConfig()`. `getResend()` calls it at first use.
  Header comment updated.
- `src/lib/email/send.ts` -- calls `assertResendConfig()` at the top of
  `sendEmail()` so the dev-log fallback branch cannot silently fire in
  production when `RESEND_API_KEY` is missing.
- `src/lib/sms/client.ts` -- same lazy pattern as email. Exported
  `assertTwilioConfig()`. `getTwilio()` calls it at first use.
- `src/lib/sms/send.ts` -- calls `assertTwilioConfig()` before the dev-log
  fallback branch.
- `src/app/api/rates/[corridorId]/route.ts` -- added the deprecation comment
  Arch locked in the Step 15 Phase B triage: "DEPRECATED: kept for
  internal/admin use. New code should call /api/rates/public?base=...&target=...
  or use rateService directly."
- `tests/lib/email/send.test.ts` -- rewrote the single import-throws test to
  import-does-NOT-throw. Added two `sendEmail()` first-call-throws tests
  covering `RESEND_API_KEY` missing and `EMAIL_FROM` missing.
- `tests/lib/sms/send.test.ts` -- rewrote the three import-throws tests to
  one import-does-NOT-throw + three `sendSms()` first-call-throws tests
  (one per missing var).
- `src/lib/rates/__tests__/fx-fetcher.test.ts` -- added a new `fx-fetcher
  build-time safety` describe block: import does not throw in prod with
  missing creds; constructing `DefaultFxRateProvider()` does not throw;
  `fetchWholesaleRate()` throws with the specific var-name message.
- `src/lib/payments/monoova/__tests__/client.test.ts` -- added `monoova client
  build-time safety`: import does not throw.
- `src/lib/kyc/sumsub/__tests__/client.test.ts` -- added `sumsub client
  build-time safety`: import does not throw.

Decisions made:
- **Lazy validation, not removal.** Fail-fast in production is preserved --
  the server still refuses to send / fetch / create clients with missing
  creds. Only the TIMING moved from module-load to first-use. This is the
  minimal change that unblocks `next build` without weakening the contract.
- **`assertXConfig` is exported for both email + sms** because `sendXxx()`
  must be able to fail-fast BEFORE the dev-log fallback branch fires. An
  SMS/email dev-log in production would be a security incident.
- **Flutterwave + Paystack unchanged.** Those adapters already require
  explicit config at constructor time -- they never had top-level throws
  and were build-safe.
- **`/api/rates/[corridorId]` deprecation comment** applied verbatim from
  Arch's Step 15 Phase B brief.
- **No new dependencies. No schema migrations.**

Phase D results:
- `npx tsc --noEmit` -- 0 errors.
- `npm test -- --run` -- 82 files / 607 tests passing (599 baseline + 8 net
  new build-safety assertions).
- `npm run build` -- SUCCEEDS in production mode. All 53 routes generated,
  zero errors, zero warnings. Was FAILING before this step.

Reviewer findings: [pending review]
Deploy: N/A

---

### Step 15k -- Public stub pages + mobile hamburger menu -- REVIEW PENDING
*Date: 2026-04-15*

Filled the three 404 footer links (`/privacy`, `/terms`,
`/compliance-info`) with server-rendered stub pages carrying a prominent
"Pending legal review" banner and tasteful placeholder sections.
Replaced the mobile fallback in `SiteHeader` with a proper hamburger
menu that opens a dropdown containing all nav links + both CTAs.

No new deps. No schema migrations. No changes outside the public-chrome
surface and three new route segments.

Files changed:
- `src/app/(marketing)/privacy/page.tsx` (new) -- server-component
  privacy stub. `LegalBanner` at top. 6 placeholder sections (collection,
  purpose, storage, sharing, rights, contact). Max-width 720px,
  Variant-D tokens only.
- `src/app/(marketing)/terms/page.tsx` (new) -- server-component terms
  stub. `LegalBanner` at top. 7 sections (eligibility, your/our
  responsibilities, prohibited uses, limitation, NSW governing law,
  contact).
- `src/app/(marketing)/compliance-info/page.tsx` (new) -- server-
  component compliance stub. `LegalBanner` at top. 6 sections (AUSTRAC
  registration with placeholder number, AML/CTF program, reporting,
  fraud controls, consumer protection, contact).
- `src/app/_components/site-header.tsx` -- replaced always-visible
  "Sign in / Start sending" mobile fallback with a 40x40 hamburger
  button (`md:hidden`). Tapping opens a full-width dropdown with
  nav links + gradient Start-sending CTA. Closes on link tap, ESC,
  and click outside. `aria-expanded` / `aria-controls` wired via
  `useId()`.
- `tests/app/marketing-pages.test.tsx` (new) -- 3 render-smoke tests,
  one per page. Each invokes the component, walks the tree (including
  function-component children), asserts the "Pending legal review"
  banner and the page's H1 text appear.

Decisions made:
- Pages are plain server components (no `'use client'`). The layout's
  `SiteHeader` + `SiteFooter` provide the public chrome automatically.
- Banner renders inline at the top of each page (role="note",
  aria-label="Legal review pending") with a warm amber background
  (#fff7e0 / #f0c040 border). Legal-review language is prominent and
  repeats each page's escalation email.
- Placeholder AUSTRAC registration number ("IND100512345") kept
  identical to the footer's existing copy. Flagged as placeholder in
  body text.
- Hamburger menu renders inline (not `fixed`) to avoid SSR/layout-shift
  issues. Outside-click handled via a transparent sibling button
  overlay that is focusable only via tab -1.
- Test walker invokes parameterless function components (server
  components with no state) so that helper components like
  `<LegalBanner />` and `<Section />` get included in the collected
  text. The admin/page test's walker is left unchanged because it
  intentionally avoids function-component invocation.

Verification:
- `npx tsc --noEmit` -- 0 errors
- `npm test -- --run` -- 599 passed (596 baseline + 3 new), 0 failures

Reviewer findings: [pending review]
Deploy: N/A

---

### Step 15j -- Provider hardening: env validation + retry + timeout + idempotency -- REVIEW PENDING
*Date: 2026-04-15*

Every third-party adapter (Sumsub, Monoova, Flutterwave, Paystack, FX rate)
now validates its env vars on module load (fail-fast in production, mock
shim in dev/test), routes outbound calls through a shared `withRetry`
helper with exponential backoff + jitter and per-attempt
`AbortController` timeouts, maps errors to typed `ProviderTimeoutError` /
`ProviderTemporaryError` / `ProviderPermanentError`, and passes provider-
supported idempotency keys on POSTs.

No new deps. No schema migrations. No changes at the handler layer --
only the outbound-call layer. The `PayoutError` subclass surface (used
by the orchestrator's retry/failover) is unchanged.

Files changed:
- `src/lib/http/retry.ts` (new) -- shared `withRetry(fn, opts)` helper
  with `AbortSignal` timeout, exponential backoff + jitter, and a default
  `shouldRetry` that retries network / timeout / 5xx / 429 but not 4xx.
  Exports typed errors (`ProviderTimeoutError`,
  `ProviderTemporaryError`, `ProviderPermanentError`) and
  `errorForStatus()` for providers to classify responses uniformly.
- `src/lib/kyc/sumsub/client.ts` -- `validateSumsubConfig()` +
  `sumsubConfig` module constant; `request()` wrapped in `withRetry`;
  `createSumsubClient()` throws clearly when called with mock creds.
  Idempotency via `externalUserId` (documented in module header).
- `src/lib/payments/monoova/client.ts` -- `validateMonoovaConfig()` +
  `monoovaConfig`; `createPayId`/`getPaymentStatus` wrapped in
  `withRetry`. Idempotency via `reference` (payIdReference).
- `src/lib/payments/payout/flutterwave.ts` --
  `validateFlutterwaveConfig()`; `initiatePayout` /`getPayoutStatus` /
  `getWalletBalance` wrapped in `withRetry` with a Flutterwave-tuned
  `shouldRetry` predicate (retries 5xx + rate-limit + timeout, skips
  `InvalidBankError` / `InsufficientBalanceError`). POSTs carry
  `Idempotency-Key: <reference>`.
- `src/lib/payments/payout/paystack.ts` -- `validatePaystackConfig()`;
  `createRecipient` / `initiatePayout` / `getPayoutStatus` wrapped in
  `withRetry` with a Paystack-tuned `shouldRetry` predicate. Transfer
  POST carries `Idempotency-Key: <reference>`.
- `src/lib/rates/fx-fetcher.ts` -- `validateFxConfig()` + `fxConfig`;
  `fetchWholesaleRate` wrapped in `withRetry` with 10s timeout default.
  Errors map to typed provider errors instead of raw strings.
- `src/lib/kyc/sumsub/index.ts`,
  `src/lib/payments/monoova/index.ts`,
  `src/lib/payments/payout/index.ts`,
  `src/lib/rates/index.ts` -- re-export the new validators + config
  constants so call-sites and tests can import them from the module
  root.
- `.env.example` -- added SUMSUB_*, MONOOVA_*, FLUTTERWAVE_*,
  PAYSTACK_*, FX_* with per-provider idempotency notes and dev/prod
  behavior documented inline.
- `tests/lib/http/retry.test.ts` (new) -- 12 tests: first-success,
  retry-then-success, exhausted attempts, permanent-no-retry, custom
  predicate, AbortSignal timeout translation, TypeError translation,
  per-attempt signal freshness, `errorForStatus` classification.
- `src/lib/kyc/sumsub/__tests__/client.test.ts` -- updated 3xx/4xx/5xx
  expectations to use typed provider errors; added
  `validateSumsubConfig` suite (prod throws, dev mock, full creds ok).
- `src/lib/payments/monoova/__tests__/client.test.ts` -- same pattern;
  added `validateMonoovaConfig` suite.
- `src/lib/payments/payout/__tests__/flutterwave.test.ts` -- updated
  `mockRejectedValueOnce` -> `mockRejectedValue` where retry is expected;
  asserts `Idempotency-Key` header; added retry count assertions; added
  `validateFlutterwaveConfig` suite.
- `src/lib/payments/payout/__tests__/paystack.test.ts` -- same pattern;
  added `validatePaystackConfig` suite.
- `src/lib/rates/__tests__/fx-fetcher.test.ts` -- updated timeout +
  error-shape expectations; added `validateFxConfig` suite.

Decisions made:
- Two `ProviderTimeoutError`s coexist: one in `src/lib/http/retry.ts`
  (generic, for Sumsub/Monoova/FX) and one already in
  `src/lib/payments/payout/types.ts` (`extends PayoutError`). Kept both
  because the payout one feeds the orchestrator's `retryable` contract;
  renaming would churn unrelated code. The Flutterwave retry predicate
  handles both.
- `AbortError` from any source (our signal firing, or fetch bubbling
  one up on its own) is normalised to `ProviderTimeoutError` inside
  `withRetry` so callers never have to sniff `DOMException.name`.
- Idempotency choice per provider documented in each module header:
  Flutterwave + Paystack use `Idempotency-Key: <reference>` header;
  Monoova relies on natural `reference` dedup; Sumsub relies on
  `externalUserId`; FX is GET-only.
- In dev/test without creds, providers expose `isMock:true` on their
  config and `createXClient()` factories throw clearly if invoked --
  existing tests construct clients directly with explicit creds, so
  nothing regresses.
- Tests use `vi.stubEnv()` + `vi.unstubAllEnvs()` because Node now
  types `process.env.NODE_ENV` as readonly.

Tests: `npx tsc --noEmit` 0 errors. `npm test -- --run` 595/595.

Reviewer findings: [pending review]
Deploy: N/A

---

### Step 15i -- BullMQ + Redis webhook queue -- REVIEW PENDING
*Date: 2026-04-15*

Replaces INLINE webhook processing with a queue. Webhook routes now verify
signatures synchronously and hand off to a dispatcher, returning 200
immediately per the CLAUDE.md rule "Webhook handlers must be fast.
Acknowledge immediately (200 OK), process via queue." The dispatcher
selection is environment-driven: BullMQ when `REDIS_URL` is set,
in-process fallback when it is not (so dev and tests never need Redis).

New deps: `bullmq`, `ioredis` only. No schema migrations. No changes to
handler internals, state machine, audit events, or idempotency logic (the
create-as-lock pattern on `WebhookEvent` is still the authoritative
dedup).

Files changed:
- `src/lib/queue/webhook-dispatcher.ts` (new) -- `WebhookProvider`,
  `WebhookJob`, `WebhookDispatcher` interface, `WEBHOOK_QUEUE_NAME`
  constant.
- `src/lib/queue/in-process-dispatcher.ts` (new) -- `InProcessDispatcher`
  calls the provider handler directly in-process. Used when `REDIS_URL`
  is absent. Throws if Flutterwave/Paystack secrets are missing
  (symmetric with the route-layer checks).
- `src/lib/queue/bullmq-dispatcher.ts` (new) -- `BullMQDispatcher` wraps
  a `Queue('webhooks')`. Job opts locked to
  `{attempts:5, backoff:{type:'exponential', delay:2000},
  removeOnComplete:1000, removeOnFail:5000}`. `jobId` = SHA-256 of
  `rawBody`, so identical provider retries dedup at enqueue. Uses
  `maxRetriesPerRequest:null` on the ioredis connection (BullMQ
  requirement for blocking ops).
- `src/lib/queue/index.ts` (new) -- `getWebhookDispatcher()` selector
  lazily picks the implementation at first call and caches. Exposes
  `__resetWebhookDispatcher()` for tests.
- `src/lib/payments/payout/verify-signature.ts` (new) -- exported
  `verifyFlutterwaveSignature` and `verifyPaystackSignature` so the
  routes can reject invalid signatures BEFORE enqueue (junk-payload DoS
  gate). Logic matches what lived inline in `payout/webhooks.ts`.
- `src/app/api/webhooks/monoova/route.ts` -- verifies signature with
  `verifyMonoovaSignature`, dispatches `{provider:'monoova', rawBody,
  signature, receivedAt}`, returns 200. 401 on bad sig (no dispatch),
  400 on bad JSON, 500 if the dispatcher throws (Redis unreachable ->
  provider retries).
- `src/app/api/webhooks/flutterwave/route.ts` -- same pattern with
  `verifyFlutterwaveSignature`.
- `src/app/api/webhooks/paystack/route.ts` -- same pattern with
  `verifyPaystackSignature`.
- `src/app/api/webhooks/sumsub/route.ts` -- same pattern with
  `verifySumsubSignature`.
- `src/workers/webhook-worker.ts` (new) -- standalone BullMQ worker.
  Re-verifies the signature (defense-in-depth: routes verify once,
  worker verifies again per attempt). Dispatches by `provider` to the
  same handlers the in-process dispatcher uses. Structured JSON logs for
  start/success/failure. Concurrency via `WEBHOOK_WORKER_CONCURRENCY`
  (default 4). Graceful SIGINT/SIGTERM shutdown.
- `package.json` -- `"worker": "tsx src/workers/webhook-worker.ts"`
  script, plus bullmq/ioredis deps.
- `.env`, `.env.example` -- `REDIS_URL=` (blank) with a comment
  explaining the in-process fallback.
- `tests/lib/queue/in-process-dispatcher.test.ts` (new, 7 tests) -- each
  provider routes to the right handler, errors bubble, missing secrets
  throw.
- `tests/lib/queue/bullmq-dispatcher.test.ts` (new, 7 tests) -- Queue
  constructed with `'webhooks'`, correct job opts, SHA-256 rawBody
  jobId, stable jobIds for identical payloads, connection passthrough,
  close().
- `tests/lib/queue/selector.test.ts` (new, 5 tests) -- in-process when
  `REDIS_URL` absent/blank, BullMQ when set, caching, reset.
- `tests/app/api/webhooks/monoova.test.ts` -- updated: mocks the
  dispatcher, asserts (1) invalid sig returns 401 WITHOUT dispatch,
  (2) valid sig dispatches and returns 200, (3) dispatcher throwing
  returns 500, (4) missing secret returns 500 without verification,
  (5) bad JSON returns 400.

Decisions made:
- **Signature verification at BOTH route and worker layers.** Route
  verification is the DoS gate (don't enqueue junk). Worker verification
  is defense-in-depth against a compromised producer. CPU cost of the
  second HMAC is negligible.
- **SHA-256(rawBody) jobId.** BullMQ rejects duplicate jobIds at enqueue.
  This is a second layer on top of the handler's `WebhookEvent` unique
  constraint. Ensures provider retries of the same body don't create
  duplicate jobs.
- **Lazy dispatcher selection** (`getWebhookDispatcher()` caches on first
  call). Tests can call `__resetWebhookDispatcher()` to re-evaluate
  `REDIS_URL` between cases.
- **Per-provider secret reads in `InProcessDispatcher`** rather than
  threading them through `WebhookJob`. Secrets never serialize to the
  queue; the worker reads them from env per attempt, same shape.
- **`WEBHOOK_JOB_OPTS` exported** so the worker config stays in one
  place and the test can assert against the exact object.
- **No handler changes.** The four handlers still own signature-check
  as their first step (they're called by the worker too). The route's
  pre-enqueue check is an additional edge layer, not a replacement.

Local dev Redis (when you WANT to exercise the queue path):
```
docker run --name kolaleaf-redis -p 6379:6379 -d redis:7
export REDIS_URL=redis://localhost:6379
npm run worker        # in one terminal
npm run dev           # in another
```

Leave `REDIS_URL` blank for normal dev/tests -- the in-process
dispatcher is transparent to callers.

Phase D results:
- `npx tsc --noEmit` -- 0 errors
- `npm test -- --run` -- 80 files, 565 tests passed (545 pre-existing +
  20 new queue/route tests)
- Manual smoke (REDIS_URL unset, signed monoova payload via `POST`):
  valid sig -> 200 `{received:true}`, invalid sig -> 401. In-process
  dispatcher invoked the handler exactly as before.

Reviewer findings: [pending review]
Deploy: N/A

---

### Step 15f-2 -- 2FA setup API routes + /account UI section -- REVIEW PENDING
*Date: 2026-04-15*

Adds the user-facing 2FA management surface: four API routes and one `/account`
UI section. With 15f-1 handling the login-side verification, this step covers
the enrollment, disable, and backup-code-regeneration flows. No schema
migrations (all 2FA columns + `TwoFactorChallenge` landed in 15c). No new deps.

Files changed:
- `src/app/api/account/2fa/setup/route.ts` (new) -- `requireAuth`. Body
  `{method: 'TOTP'|'SMS'}`. TOTP path: fresh secret (NOT persisted -- echoed
  back on response and committed only via `/enable`), otpauth URI labelled
  with user's primary verified EMAIL identifier, QR data URL. SMS path:
  requires a verified PHONE identifier (400 `phone_not_verified` otherwise);
  issues an SMS challenge via `issueSmsChallenge` and returns `challengeId`.
  Both paths: 400 `already_enabled` if `user.twoFactorMethod !== 'NONE'`;
  writes `TWO_FACTOR_SETUP_INITIATED` AuthEvent with `{method}`.
- `src/app/api/account/2fa/enable/route.ts` (new) -- `requireAuth`. Commits
  enrollment. TOTP: `verifyTotpCode(secret, code)`, 400 `invalid_code` on
  miss. SMS: `verifyChallenge(challengeId, code)`, 400 `invalid_code` on
  miss. On success: generates 8 raw backup codes + hashes, `$transaction`
  updates `User{twoFactorMethod, twoFactorSecret|null, twoFactorBackupCodes,
  twoFactorEnabledAt}` + writes `TWO_FACTOR_ENABLED` AuthEvent. Returns
  `{enabled:true, backupCodes: rawCodes}` -- the ONLY place raw codes exist.
- `src/app/api/account/2fa/disable/route.ts` (new) -- `requireAuth`. Body
  `{code, challengeId?}`. 400 `not_enabled` if off. Verifies the code using
  the user's current method (TOTP secret or SMS challenge) OR falls back to
  a backup code. On success: `$transaction` clears 2FA columns + deletes
  all OTHER sessions (`userId=X, id: {not: currentSessionId}`) to
  force-logout other devices + writes `TWO_FACTOR_DISABLED` AuthEvent.
  SMS-disable workflow documented in route header: clients should call
  `/setup` with method=SMS for a fresh challenge, OR submit a backup code.
- `src/app/api/account/2fa/regenerate-backup-codes/route.ts` (new) --
  `requireAuth`. Same code-verification as `/disable`. On success: generates
  8 fresh codes, `$transaction` updates `User.twoFactorBackupCodes = hashes`
  + writes `TWO_FACTOR_BACKUP_CODES_REGENERATED`. Returns raw codes once.
- `src/app/api/account/me/route.ts` (new) -- GET-only `requireAuth`.
  Returns minimal account summary for the `/account` client components:
  `{twoFactorMethod, twoFactorEnabledAt, hasVerifiedPhone, phoneMasked,
  backupCodesRemaining}`. Never returns the 2FA secret or backup-code hashes.
- `src/app/(dashboard)/account/_components/two-factor-section.tsx` (new) --
  client component rendering the full 2FA state-machine: view (on/off),
  picker (TOTP vs SMS with disabled-SMS-when-no-phone), TOTP setup
  (QR + manual-entry secret + 6-digit input + Enable), SMS setup (input +
  Resend + Enable), backup-codes reveal panel (4x2 grid, Copy-all,
  "I've saved these" checkbox gating Continue), disable flow (modal-style
  inline, current code OR backup code, warn banner), regen flow (same
  verification, fresh codes panel). Uses Variant D tokens only (no raw
  Tailwind colours for state). All routes called: `/api/account/me`,
  `/api/account/2fa/setup`, `/api/account/2fa/enable`,
  `/api/account/2fa/disable`, `/api/account/2fa/regenerate-backup-codes`.
- `src/app/(dashboard)/account/page.tsx` -- swapped the old "Manage in
  mobile app" placeholder card for `<TwoFactorSection />`. Page stays a
  client component (KYC fetch, logout). No other edits.

New tests (+25):
- `tests/app/api/account/2fa/setup.test.ts` (7 cases)
- `tests/app/api/account/2fa/enable.test.ts` (7 cases)
- `tests/app/api/account/2fa/disable.test.ts` (7 cases)
- `tests/app/api/account/2fa/regenerate-backup-codes.test.ts` (4 cases)

Phase D results:
- `npx tsc --noEmit`: 0 errors.
- `npm test -- --run`: 73 files / 520 tests passed (was 73/495; +25 new).
- Manual smoke sequence documented in REVIEW-REQUEST.

Fixes applied post-Richard review (0 Must Fix, 5 Should Fix — all applied):
1. `verifyChallenge(userId, challengeId, code)` — added userId scoping as
   defense-in-depth. Updated all 4 call sites (enable, disable,
   regenerate-backup-codes, verify-2fa). Switched
   `prisma.twoFactorChallenge.findUnique` to `findFirst` with `{id, userId}`.
   Added a cross-user regression test in
   `tests/lib/auth/two-factor-challenge.test.ts`.
2. Removed the dead-end "Can't find your code?" button in the SMS-disable
   flow (`two-factor-section.tsx`). Strengthened the surrounding copy
   instead: "enter one of your saved backup codes, or the most recent SMS
   code sent at sign-in".
3. `/api/account/me` 401 handling in `two-factor-section.tsx` — the initial
   load and the `continueAfterBackupCodes` refresh both detect 401 and
   redirect to `/login` instead of rendering a bogus "NONE" state.
4. `src/app/api/account/me/route.ts` maskPhone comment updated to match
   actual bullet-ellipsis output (`+61 ••• 678`).
5. Dropped the misleading `remainingBackupCodes` AuthEvent metadata field in
   `/api/account/2fa/disable/route.ts` (twoFactorBackupCodes is cleared on
   disable, so the pre-disable count was confusing). Also removed the now
   unused `remainingBackupHashes` local.

Post-fix Phase D:
- `npx tsc --noEmit`: 0 errors.
- `npm test -- --run`: 73 files / 521 tests passed (+1 cross-user regression).

Reviewer findings: 5 Should Fix — all addressed above.
Deploy: N/A

---

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

**Closed in Step 15:**
- ~~`/activity/[id]` -- transfer detail page~~ -- closed in Step 15h
- ~~`/privacy`, `/terms`, `/compliance-info` -- footer stub links (404 today)~~ -- closed in Step 15k
- ~~Mobile hamburger menu in `SiteHeader`~~ -- closed in Step 15k
- ~~4 pre-existing TS errors in `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts`~~ -- fixed in Step 15b
- ~~`npm run build` fails in production mode~~ -- fixed in Step 15l (lazy env validation)

**Still open:**
- Login rate limiting (no protection against brute force)
- Account page user name/email display (not requested in any brief; nice-to-have)
- Test flakiness in `tests/lib/transfers/queries.test.ts` (4 tests fail under `afterEach` cleanup race; pre-existing)
- `/api/rates/[corridorId]` route is unused by any UI -- deprecation comment added in 15l; remove in a future cleanup step
- Cosmetic `transferEvent` self-loop `CREATED -> CREATED` in `src/lib/transfers/create.ts`
- `where: Record<string, unknown>` typing in admin routes (should use Prisma-generated input types)
- Activity page missing empty-state copy for "no transfers yet"
- Form `htmlFor` / `aria-describedby` accessibility associations
- `RateService` singleton not consolidated (instantiated per-file in 4 places)
- Admin rate POST and transfer POST missing HTTP-layer test coverage
- `/api/account/phone/add` does not write an AuthEvent (only the verified state-flip is audited)
- Regex E.164 phone normalisation in `src/lib/auth/phone.ts` is a placeholder (needs `libphonenumber-js`)

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Prisma 7 with adapter pattern (PrismaPg) for database connectivity -- 2026-04-14
- cuid() for all primary keys (URL-safe, sortable) -- 2026-04-14
- @db.Decimal for all money amounts, never float -- 2026-04-14
- Cascade delete on UserIdentifier and Session only; no cascade on Transfer or Recipient -- 2026-04-14
- @@unique([baseCurrency, targetCurrency]) on Corridor for multi-corridor support -- 2026-04-14
- Lazy env validation on provider clients (first-use, not module-load) -- 2026-04-16
