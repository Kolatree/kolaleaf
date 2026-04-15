# Review Request -- Step 15d

**Ready for Review:** YES
**Step:** 15d -- Resend integration + email verification + password reset flows
**Builder:** Bob
**Date:** 2026-04-15

---

## Scope

Ships:
- Resend SDK wiring + dev/test `[email-dev]` stdout fallback.
- Email-verification flow: signup dispatches a 24h token; `/api/auth/verify-email`
  flips `UserIdentifier.verified`; `/api/auth/resend-verification` (auth required,
  5/hr rate limit) re-sends on demand.
- Password-reset flow: `/api/auth/request-password-reset` (public, enumeration-safe,
  3/hr silent rate limit) sends a 1h token; `/api/auth/reset-password` validates,
  hashes, force-logs-out all sessions.
- New `requireEmailVerified` middleware; enforced on `POST /api/transfers`.
- Registration now defaults `UserIdentifier.verified=false` (was `true`) so the
  verification flow does real work. Login gate relaxed accordingly.

No schema migrations (15c covered all tables). One new dep: `resend`.

Test count: 392 → 436 (44 new, all green). Typecheck 0 errors.

---

## Files Changed

### New

- `src/lib/auth/tokens.ts` -- `generateVerificationToken()`, `hashToken()`;
  32 random bytes hex, sha256 hash-only at rest.
- `src/lib/email/client.ts` -- Resend init; fail-fast in production.
- `src/lib/email/send.ts` -- `sendEmail()` with dev `[email-dev]` fallback.
- `src/lib/email/templates/verify-email.ts` -- `renderVerificationEmail()`,
  inline-styled HTML + plain text + HTML-escape helpers.
- `src/lib/email/templates/password-reset.ts` -- `renderPasswordResetEmail()`,
  includes IP/user-agent context block when provided.
- `src/lib/email/index.ts` -- barrel.
- `src/app/api/auth/verify-email/route.ts` -- public GET, generic expired page
  on all failure modes, success flips identifier verified+verifiedAt.
- `src/app/api/auth/resend-verification/route.ts` -- requireAuth,
  already-verified short-circuit, 5/hr limit (429), invalidates prior unused tokens.
- `src/app/api/auth/request-password-reset/route.ts` -- public POST,
  generic response regardless of email existence / rate limit / send success.
- `src/app/api/auth/reset-password/route.ts` -- public POST, validates,
  hashes, marks token used, deletes all sessions.
- `.env.example` -- fresh file with variable names, no secrets.
- `tests/lib/auth/tokens.test.ts` -- 6 tests.
- `tests/lib/email/send.test.ts` -- 4 tests (dev log, Resend path, error
  propagation, prod-missing-key throw).
- `tests/lib/email/templates/verify-email.test.ts` -- 4 tests.
- `tests/lib/email/templates/password-reset.test.ts` -- 5 tests.
- `tests/app/api/auth/resend-verification.test.ts` -- 5 tests.
- `tests/app/api/auth/verify-email.test.ts` -- 5 tests.
- `tests/app/api/auth/request-password-reset.test.ts` -- 5 tests.
- `tests/app/api/auth/reset-password.test.ts` -- 7 tests.

### Modified

- `src/lib/auth/register.ts` (L27-L45) -- new users land with `verified=false`.
- `src/lib/auth/login.ts` (L26-L36) -- removed the "Identifier not verified"
  throw. Comment explains why (user needs to log in to request a new link;
  real gate is `requireEmailVerified` on transfers).
- `src/lib/auth/middleware.ts` (L38-L55) -- added `requireEmailVerified()`.
- `src/lib/auth/password.ts` (L13-L26) -- added `validatePasswordComplexity()`
  helper (length>=8, matching existing register policy).
- `src/app/api/auth/register/route.ts` (L1-L9, L36-L44, L51-L72) -- added
  verification-email dispatch after successful signup. Fire-and-forget;
  signup succeeds even if Resend fails. Comment explains the choice.
- `src/app/api/transfers/route.ts` (L4, L36-L41, L54-L63) -- added
  `requireEmailVerified` before `requireKyc`; `email_unverified` error surfaces
  as `{error:'email_unverified', message:'Please verify your email before sending money.'}` with 403.
- `src/lib/auth/__tests__/login.test.ts` (L24-L36, L64-L82) -- helper now
  flips identifier to verified post-register; old "throws on unverified" test
  rewritten to assert new behavior.
- `src/lib/auth/__tests__/register.test.ts` (L41-L46) -- identifier assertion
  updated to `verified=false` + `verifiedAt=null`.
- `.env` -- added `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`.
- `package.json` / `package-lock.json` -- added `resend` dep.

---

## Key Decisions

1. **Registration now creates unverified email identifiers.** Only way the
   verification flow has teeth. Login gate relaxed in the same PR so users can
   sign in to request a new link. Documented inline and in BUILD-LOG.
2. **Hash-only token storage.** Raw tokens only appear in the URL to the user.
3. **Email enumeration prevention.** `request-password-reset` returns identical
   200 bodies across all branches (exists, missing, rate-limited, send-failed).
4. **Fire-and-forget on signup email.** Resend outage does not fail signup.
5. **Force-logout on password reset.** Non-negotiable security baseline.
6. **Dev-mode `[email-dev]` log.** No SMTP round trip locally. Production is
   fail-fast at module import.

---

## Open Questions

1. **Phone identifier verification at login.** Brief scope is emails for 15d;
   phone is 15g. I removed the universal `!identRecord.verified` gate rather
   than adding a type-aware one. If Richard/Arch wants a narrower
   `type==='EMAIL' ? allow : block` version, I can add it.
2. **Password complexity on reset.** Reused existing `length>=8` from register
   to avoid breaking current users. Stricter rules (mixed case/digit/symbol)
   would need explicit buy-in because they'd reject some current passwords.
3. **UI side.** No UI landed this step. The `/reset-password?token=...` link
   needs a React page in Variant D to POST to `/api/auth/reset-password`.
   Not in 15d scope — flagging for 15e or a Wave 1 UI follow-up step.

---

## Verification

```
npx tsc --noEmit        → TypeScript compilation completed
npm test -- --run       → 436/436 passing (392 baseline + 44 new)
```

Dev smoke (`npm run dev`, port 3001 — 3000 busy):

```
POST /api/auth/register {...}
  → 201 {user:{...}}
  → stdout: [email-dev] Subject: Verify your Kolaleaf email
           Verify here: http://localhost:3000/api/auth/verify-email?token=95ff4c3b...

POST /api/auth/request-password-reset {"email":"smoke-TS@test.com"}
  → 200 {"message":"If an account exists with that email, we've sent a reset link."}
  → stdout: [email-dev] Subject: Reset your Kolaleaf password
           Reset your password here: http://localhost:3000/reset-password?token=96059f19...
           This request came from: IP ::1 • Device curl/8.7.1

POST /api/auth/request-password-reset {"email":"nonexistent@test.com"}
  → 200 identical body; no [email-dev] log (enumeration prevention verified end-to-end)
```

---

## Files to Review (priority order)

1. `src/lib/auth/login.ts` -- gate removal. Single biggest behavior change.
2. `src/lib/auth/register.ts` -- identifier default change.
3. `src/app/api/auth/request-password-reset/route.ts` -- enumeration-safety logic.
4. `src/app/api/auth/reset-password/route.ts` -- force-logout + token validation.
5. `src/lib/auth/middleware.ts` -- new `requireEmailVerified`.
6. `src/app/api/auth/verify-email/route.ts` -- generic-failure page consistency.
7. `src/lib/email/{client,send}.ts` -- prod/dev branching + fail-fast init.
8. `src/lib/email/templates/*.ts` -- HTML-escape correctness.
9. `src/app/api/transfers/route.ts` -- `email_unverified` error shape.
