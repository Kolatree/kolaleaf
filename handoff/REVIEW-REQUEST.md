# Review Request -- Step 18: Verify-First Registration (3-step wizard)

**Ready for Review:** YES
**Builder:** Bob
**Date:** 2026-04-17
**Brief:** `handoff/ARCHITECT-BRIEF.md`

---

## Summary

Step 18 replaces the monolithic `/api/auth/register` with a three-step wizard that verifies the email BEFORE creating any `User` row. The flow is `/register` (email only -> send 6-digit code) -> `/register/verify` (enter code, open 30-min claim window, no session yet) -> `/register/details` (name + AU address + password, transactional create of User + verified UserIdentifier + Session + REGISTRATION/LOGIN AuthEvents, consume the pending row) -> `/kyc` (skippable Sumsub prompt; hard KYC block stays at transfer creation per CLAUDE.md). The legacy `/api/auth/register` route and its tests are deleted and the endpoint now 404s. A new `PendingEmailVerification` model and nullable AU address columns on `User` are added via migration `20260417035232_pending_email_verification_and_address` (backfill-safe). `/api/auth/send-code` is enumeration-proof (always 200), `/api/auth/verify-code` never issues a session, and `/api/auth/complete-registration` is the only new surface that mutates `User`. All reliability guarantees from the logged-in email-verification path (5 sends/hour, 5 attempts/token, 30-min TTL, sha256(code) at rest) carry over. 655 -> 695 passing tests (+44 new + 3 e2e -- 7 deleted legacy). `npx tsc --noEmit` clean. `npm run build` clean.

---

## Files

### Added

| Path | Purpose |
|---|---|
| `prisma/migrations/20260417035232_pending_email_verification_and_address/migration.sql` | Creates `PendingEmailVerification` table + adds 6 nullable AU address columns to `User` |
| `src/lib/auth/pending-email-verification.ts` | `issuePendingEmailCode` + `verifyPendingEmailCode`; rate-limited (5/hr), attempt-capped (5), 30-min TTL, 30-min claim window, sha256 hash-at-rest, idempotent-verify-within-window |
| `src/app/api/auth/send-code/route.ts` | Step 1: always 200, enumeration-proof; 400 only on malformed email |
| `src/app/api/auth/verify-code/route.ts` | Step 2: validates code, opens claim window; 400/429 error shape identical to the logged-in verify path; never issues a session |
| `src/app/api/auth/complete-registration/route.ts` | Step 3: `prisma.$transaction` callback-form; creates User + verified UserIdentifier + Session, writes REGISTRATION + LOGIN AuthEvents, deletes PendingEmailVerification; AU state/postcode validation; 409 on verified-email race; sets session cookie via `setSessionCookie` |
| `src/app/(auth)/register/verify/page.tsx` | Step 2 UI: 6-digit input, Resend wired to `/api/auth/send-code`; Suspense-wrapped `useSearchParams` per Next 16 |
| `src/app/(auth)/register/details/page.tsx` | Step 3 UI: full name + address line 1/2 + city + AU state `<select>` + 4-digit postcode + disabled "Australia" country + password; "Edit" link back to /register |
| `src/app/(dashboard)/kyc/page.tsx` | Post-registration KYC prompt; `Verify identity now` posts `/api/kyc/initiate` then navigates to Sumsub URL; `Skip for now` -> /send |
| `tests/lib/auth/pending-email-verification.test.ts` | 12 unit tests |
| `tests/app/api/auth/send-code.test.ts` | 8 route tests |
| `tests/app/api/auth/verify-code.test.ts` | 10 route tests |
| `tests/app/api/auth/complete-registration.test.ts` | 14 route tests (every validation branch + 409 race + full success path) |
| `tests/e2e/register-wizard.test.ts` | 3 e2e tests against the real DB (happy path, duplicate-email silent no-op, skip-verify rejection) |

### Modified

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Added `PendingEmailVerification` model; added 6 nullable fields on `User` (addressLine1, addressLine2, city, state, postcode, country) |
| `src/app/(auth)/register/page.tsx` | Rewritten: single email input, calls `/api/auth/send-code`, routes to `/register/verify?email=...` |
| `handoff/BUILD-LOG.md` | Step 18 done-block prepended |

### Deleted

| Path | Reason |
|---|---|
| `src/app/api/auth/register/route.ts` | Superseded by the 3-step wizard; Next now serves 404 (confirmed via curl) |
| `tests/app/api/auth/register.test.ts` | Paired tests (7 cases) for the deleted handler |

---

## Deliberate Design Calls

Not strictly spec'd by the brief -- flagged for your attention:

1. **Pending row is UPSERTED, not appended.** A re-send (step 1 called again for the same email) wipes `attempts`, `verifiedAt`, `claimExpiresAt` and writes a fresh `codeHash` + `expiresAt`. Matches the brief's natural "one pending row per email" shape and avoids a cleanup job for stale rows.

2. **Burning a token uses `expiresAt = now - 1ms`.** `PendingEmailVerification` has no `usedAt` column (it's deleted by step 3 within minutes anyway). The Nth wrong attempt sets expiresAt in the past so the next call hits the `expired` branch, and a user clicking "Resend" just upserts a fresh row over it.

3. **Re-verify within the claim window is idempotent success.** Calling `/api/auth/verify-code` again after it already succeeded (inside the claim window) returns `ok: true` instead of `used`. This makes the UX resilient to back-button reloads on step 3 that re-fire step 2. After the claim window closes the same input returns `used`.

4. **Verification email uses `recipientName: "there"`.** No User row exists yet. "there" keeps the copy warm without piping user-supplied strings into the email subject.

5. **`/kyc` lives in `(dashboard)` group.** The user has a session after step 3, so the existing server-side auth gate applies. Page renders its own gradient shell (no bottom nav) because KYC is a one-off intercept, not a nav destination.

6. **`complete-registration` performs a soft cleanup of stale UNverified identifiers.** If a legacy (pre-wizard) unverified `UserIdentifier` exists for the same email, it's deleted inside the transaction before the new verified row is created. Verified duplicates still throw 409.

7. **Country is always written server-side as `"AU"`** and never read from the request body. The UI displays a disabled "Australia" field.

---

## Verification

- `DATABASE_URL=... npm test -- --run` -- **90 files, 695 tests passed, 0 failed** (baseline 655 + 44 new route/helper + 3 e2e -- 7 deleted legacy)
- `npx tsc --noEmit` -- **0 errors**
- `rm -rf .next && npm run build` -- **succeeded**, all new routes listed in the build output
- Local curl smoke (against `npm run dev`):
  - `POST /api/auth/send-code` -> 200 `{ok:true}`
  - `POST /api/auth/verify-code` -> 200 `{verified:true}`, no Set-Cookie
  - `POST /api/auth/complete-registration` -> 201 + `Set-Cookie: kolaleaf_session=...`
  - `GET /api/account/me` -> 200 `{fullName, email:{verified:true}, ...}`
  - `POST /api/auth/register` (legacy) -> 404
- DB after smoke: User has addressLine1/city/state/postcode/country=AU populated, UserIdentifier.verified=true, PendingEmailVerification row gone, AuthEvents = [REGISTRATION, LOGIN]

---

## Open Questions

None. The brief was unambiguous.

---

## Known Gaps (not part of Step 18)

- No changes to the logged-in change-email flow (`EmailVerificationToken` model kept side-by-side).
- No changes to the existing `/verify-email` page (still used by the login -> unverified path for legacy users).
- International address support remains out of scope.
- Migrating / deleting the 2 existing unverified test users is Arch's post-deploy cleanup.
