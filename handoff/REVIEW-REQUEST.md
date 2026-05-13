# Review Request -- Wave 2a Phase 11.5 Privacy + Universal Links Slice

**Ready for Review:** YES for this local slice. External WhatsApp allowlist and deployed AASA verification remain Phase 14/ops blockers.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

This Phase 11.5 slice closes the local privacy/deep-link gaps that did not require provider access. Lock-screen Live Activity rendering now gates through a redacted card when SwiftUI reports redaction or reduced luminance, hiding recipient and amount copy. The iOS deep-link router now handles scoped HTTPS universal links for `/transfer/{id}` and `/refer/{token}` in addition to the existing `kolaleaf://transfer/{id}` scheme. Referral universal links feed the existing `ReferralCapture` keychain-backed service. The public AASA file is added with exact `/transfer/*` and `/refer/*` components only.

## Files Changed In This Slice

- `ios/Kolaleaf/App/DeepLinkRouter.swift` — adds HTTPS universal-link dispatch for transfer detail and referral capture.
- `ios/Kolaleaf/App/KolaleafApp.swift` — passes `ReferralCapture` into the async router from `.onOpenURL`.
- `ios/KolaleafWidgets/LockScreenCard.swift` — adds `LockScreenCardPrivacyGate`, redacted lock-screen card, and redacted copy helpers.
- `ios/KolaleafWidgets/TransferLiveActivity.swift` — uses the privacy gate for lock-screen/banner rendering.
- `ios/KolaleafTests/App/AppStateTests.swift` — adds `DeepLinkRouterTests`.
- `ios/KolaleafWidgetsTests/KolaleafTransferAttributesTests.swift` — adds lock-screen redaction tests.
- `public/.well-known/apple-app-site-association` — scoped AASA file.
- `tests/app/aasa.test.ts` — asserts AASA path scope.
- `handoff/BUILD-LOG.md` — records Phase 11 closeout and Phase 11.5 slice state.

## Validation

- `npm test -- --run tests/app/aasa.test.ts` — 1 file / 1 test passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `xcodebuild test -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97' -only-testing:KolaleafTests/DeepLinkRouterTests -only-testing:KolaleafWidgetsTests/KolaleafTransferAttributesTests` — 20 tests passed.
- `xcodebuild -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -configuration Debug -destination 'platform=iOS,name=iPhone' -derivedDataPath ios/build/DerivedData build` — passed.
- `xcrun devicectl device install app --device iPhone.coredevice.local .../Kolaleaf.app` — installed `com.kolaleaf.app`.
- `xcrun devicectl device process launch --device iPhone.coredevice.local com.kolaleaf.app` — launched.

## Remaining Review Scope

- Phase 11.5 still needs App Attest/device-attestation backend integration, new-device alert UX, Sentry PII scrubber, notification preferences, and compliance-copy review.
- Phase 14 still needs deployed AASA verification and Meta/WhatsApp allowlist confirmation.

---

# Review Request -- Wave 2a Phase 11 Security / 2FA

**Ready for Review:** YES for local Phase 11 implementation. Production KYC 500 remains operationally blocked on Railway/Sumsub access.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

Phase 11 now has a real iOS Security surface instead of the previous Face ID-only stub. The Account tab security route supports Face ID app unlock, TOTP setup with QR/manual key, code verification, one-time backup-code display, backup-code regeneration, disabling 2FA, and SMS 2FA setup when the account has a verified phone. The sign-in flow now routes `requires2FA` users into an iOS 2FA challenge screen and calls `/api/v1/auth/verify-2fa`, then refreshes `/account/me` before entering the authenticated graph.

Backend review also found `/auth/verify-2fa` still returned non-canonical errors; that route now returns `{ error, reason }` for expired, invalid, unauthenticated, and server failures so iOS can route by reason consistently.

## Files Changed In This Phase 11 Pass

- `ios/Kolaleaf/Features/Security/SecurityMenuView.swift` — full Security menu, TOTP/SMS setup sheets, backup-code sheet, regenerate/disable verification sheet, and `SecurityMenuViewModel`.
- `ios/Kolaleaf/Features/Onboarding/OnboardingCoordinator.swift` — routes `requires2FA` logins into the challenge screen.
- `ios/Kolaleaf/Features/Onboarding/SignInView.swift` — adds `TwoFactorSignInViewModel` and `TwoFactorSignInView`.
- `ios/Kolaleaf/Networking/DTOs/{AccountDTOs.swift,AuthDTOs.swift}` — Phase 11 2FA request/response DTOs.
- `ios/Kolaleaf/Networking/Endpoints/{AccountEndpoints.swift,AuthEndpoints.swift}` — 2FA setup/enable/disable/regenerate and sign-in verify endpoints.
- `ios/Kolaleaf/Networking/APIError.swift` — maps `invalid_code` into the typed code-invalid branch.
- `src/app/api/v1/auth/verify-2fa/route.ts` — canonical error envelope fix.
- `tests/app/api/v1/auth/verify-2fa.test.ts` — asserts canonical 401/expired envelopes.

## Validation

- `npm test -- --run tests/app/api/v1/auth/verify-2fa.test.ts tests/app/api/v1/account/2fa/setup.test.ts tests/app/api/v1/account/2fa/enable.test.ts tests/app/api/v1/account/2fa/disable.test.ts tests/app/api/v1/account/2fa/regenerate-backup-codes.test.ts` — 5 files / 32 tests passed.
- `npx tsc --noEmit` — clean.
- `npm run build` — clean.
- `xcodebuild -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -configuration Debug -destination 'platform=iOS,name=iPhone' -derivedDataPath ios/build/DerivedData build` — build succeeded for paired iPhone.
- `xcrun devicectl device install app --device iPhone.coredevice.local /Users/ao/Documents/projects/Kolaleaf/ios/build/DerivedData/Build/Products/Debug-iphoneos/Kolaleaf.app` — installed `com.kolaleaf.app`.
- `xcrun devicectl device process launch --device iPhone.coredevice.local com.kolaleaf.app` — launched successfully.

## Remaining Review Scope

- Review the UX decision that SMS 2FA setup is supported, while later sensitive SMS 2FA changes accept backup code verification. The current backend has no dedicated "issue SMS challenge for already-enabled 2FA management" route.
- Phase 11.5 still needs reconciliation: App Attest backend integration, new-device alert, compliance copy review, Sentry PII scrubber, notification preferences, and universal-link referral leftovers.
- Production `/api/v1/kyc/initiate` 500 is still not proved fixed until Railway/Sumsub logs and env are inspected.

---

# Review Request -- Active Recovery: Phase 11 partial + D-wave phone-first + web KYC

**Ready for Review:** YES for the recovery patch. Production KYC 500 remains operationally blocked on Railway/Sumsub access.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

This active recovery pass fixes two concrete web KYC regressions and updates stale planning state. `POST /api/v1/kyc/access-token` now returns the canonical `{ error, reason }` envelope advertised by its OpenAPI schema, so iOS/web clients can route by stable reason codes. `/kyc/mock` now wraps `useSearchParams()` behind Suspense for Next build compatibility. The phone-first onboarding plan is no longer labelled as draft because backend/iOS core rails have landed locally; production readiness remains gated on Twilio/Railway env verification and device/simulator E2E. The production `/api/v1/kyc/initiate` 500 remains unresolved until Railway logs and Sumsub env/config are inspected.

## Files Changed In This Recovery Pass

- `src/app/api/v1/kyc/access-token/route.ts` — canonical `jsonError` envelopes with reasons: `unauthenticated`, `forbidden`, `kyc_already_verified`, `kyc_no_application`, `kyc_access_token_failed`.
- `src/app/api/v1/kyc/access-token/_schemas.ts` — documents 500 as `ErrorEnvelope`.
- `tests/app/api/v1/kyc/access-token.test.ts` — asserts canonical reason codes for 401/409/500.
- `src/app/(dashboard)/kyc/mock/page.tsx` — splits inner component and wraps search-param usage in Suspense.
- `docs/plans/2026-05-13-001-feat-phone-first-onboarding-plan.md` — status corrected to partially implemented locally.
- `docs/plans/2026-05-13-002-investigate-kyc-initiate-500.md` — status clarified as unresolved production issue, not fixed by local mock/web recovery.
- `handoff/BUILD-LOG.md` — active status and recovery todo list updated.

## Validation

- `npm run db:up` — started existing `kolaleaf-db` container.
- `npm test -- --run tests/app/api/v1/kyc/access-token.test.ts tests/app/api/v1/kyc/mock-complete.test.ts` — 2 files / 10 tests passed.
- `npx tsc --noEmit` — clean.
- `npm run build` — clean; includes `/api/v1/kyc/access-token`, `/api/v1/kyc/mock/complete`, and `/kyc/mock`.
- `xcodebuild -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -configuration Debug -destination 'platform=iOS,name=iPhone' -derivedDataPath ios/build/DerivedData build` — build succeeded for paired iPhone.
- `xcrun devicectl device install app --device iPhone.coredevice.local ios/build/DerivedData/Build/Products/Debug-iphoneos/Kolaleaf.app` — installed `com.kolaleaf.app`.
- `xcrun devicectl device process launch --device iPhone.coredevice.local com.kolaleaf.app` — launched successfully.

## Remaining Review Scope

- Verify the route envelope changes are compatible with iOS `APIError` reason dispatch.
- Verify `/kyc/mock` builds under Next 16.
- Confirm no production claim is made for the `/kyc/initiate` 500 until Railway/Sumsub logs are inspected.
- Reconcile Phase 11 scope: the current app only has Phase 11 slim Face ID security; full TOTP/backup-code/SMS 2FA remains to build.

---

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
