# Review Request -- Wave 2a Phase 12 Accessibility + Dynamic Type Send Flow Slice

**Ready for Review:** YES for the focused money-path accessibility/Dynamic Type slice. This is not a claim that the whole app accessibility audit is complete.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

Closes the next local Phase 12 readiness slice for the send flow. The app now bundles the Inter font files declared by the generated Info.plist, typography tokens use Dynamic Type-aware custom fonts, and the core send/PayID/receipt surfaces have clearer VoiceOver labels for amounts, exchange rates, PayID/reference values, receipt totals, and destructive/continuation actions.

Review found and fixed two implementation risks before handoff:

- The generated `ios/Kolaleaf.xcodeproj` and `ios/Kolaleaf/Info.plist` are ignored; `ios/project.yml` is canonical. Regenerating with XcodeGen flattens `Kolaleaf/Resources/Inter-fonts` into app-bundle font files, so `UIAppFonts` must stay as flat filenames.
- A first pass accidentally grouped the entire `SendView` as one accessibility element. That was narrowed to only the amount display so recipient selection, keypad controls, slide confirmation, and error actions remain reachable.

## Files Changed In This Slice

- `ios/Kolaleaf/Resources/Inter-fonts/*` — Inter TTF files and upstream license, used by the existing app font declarations.
- `ios/Kolaleaf/Design/Tokens/KolaTypography.swift` — custom Inter tokens now scale relative to Dynamic Type text styles.
- `ios/Kolaleaf/Features/Send/SendView.swift` — amount/rate/NGN/error accessibility labels without collapsing the whole screen.
- `ios/Kolaleaf/Features/Send/PayIDInstructionsView.swift` — PayID/reference/countdown/step/action accessibility labels and hints.
- `ios/Kolaleaf/Features/Send/ReceiptView.swift` — receipt headline, amount, summary, share, and repeat-send accessibility labels/hints.
- `ios/KolaleafTests/Features/Send/SendFlowAccessibilityTests.swift` — AX5 render smoke coverage for Send, PayID instructions, and Receipt.
- `handoff/BUILD-LOG.md` and `handoff/REVIEW-REQUEST.md` — current Phase 12 status and validation evidence.

## Validation

- `xcodegen generate` — regenerated the ignored project and generated plist from `ios/project.yml`.
- `xcodebuild test -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97' -only-testing:KolaleafTests/SendFlowAccessibilityTests` — 3 tests passed; no missing Inter font parser warnings after the source-of-truth fix.
- `xcodebuild -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -configuration Debug -destination 'platform=iOS,name=iPhone' -derivedDataPath ios/build/DerivedData build` — passed; build output copies Inter TTFs into the app bundle.
- `xcrun devicectl device install app --device iPhone.coredevice.local /Users/ao/Documents/projects/Kolaleaf/ios/build/DerivedData/Build/Products/Debug-iphoneos/Kolaleaf.app` — installed `com.kolaleaf.app`.
- `xcrun devicectl device process launch --device iPhone.coredevice.local com.kolaleaf.app` — launched.

## Remaining Review Scope

- This is a focused send-flow slice. Full whole-app accessibility, VoiceOver rotor order, Reduce Motion behavior, localization, and iPad review remain Phase 12 work.
- The generated `.xcodeproj` and `Info.plist` remain intentionally ignored; reviewers should regenerate from `ios/project.yml` when validating project-resource behavior.

---

# Review Request -- Wave 2a Phase 12 OpenAPI Contract Hardening Slice

**Ready for Review:** YES for local contract registration and `issue-payid` canonical error envelopes.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

Closes the Phase 12 U84 bug called out in the plan: `POST /api/v1/transfers/{id}/issue-payid` had a colocated schema but was not imported by the OpenAPI registry or exported from the schema barrel. While wiring that route into the generated contract, review found the handler still returned ad hoc `{ error }` bodies even though the schema advertises `ErrorEnvelope`. The route now returns canonical `{ error, reason }` responses for unauthenticated, email-unverified, not-found, forbidden, KYC-blocked, concurrent-modification, invalid-state, and unexpected PayID issuance failures.

## Files Changed In This Slice

- `src/app/api/v1/openapi/route.ts` — imports `transfers/[id]/issue-payid/_schemas`.
- `src/lib/schemas/index.ts` — exports the issue-PayID schema from the central contract barrel.
- `src/app/api/v1/transfers/[id]/issue-payid/_schemas.ts` — documents `payidExpiresAt` and 500 `ErrorEnvelope`.
- `src/app/api/v1/transfers/[id]/issue-payid/route.ts` — canonical `jsonError` envelopes.
- `tests/app/api/v1/transfers/issue-payid.test.ts` — asserts stable reason codes.
- `tests/e2e/openapi-endpoint.test.ts` — exact OpenAPI path count now includes `/transfers/{id}/issue-payid`.

## Validation

- `npm test -- --run tests/app/api/v1/transfers/issue-payid.test.ts tests/e2e/openapi-endpoint.test.ts` — 2 files / 13 tests passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed; route list includes `/api/v1/transfers/[id]/issue-payid`.

## Remaining Review Scope

- This slice does not add Swift-side live OpenAPI schema decoding; it closes the missing route registration and canonical envelope mismatch first.
- Full CI enforcement still belongs with Xcode Cloud/TestFlight setup once signing/App Store Connect access is available.

---

# Review Request -- Wave 2a Phase 11.6 Coordinator + Privacy-First Analytics Slice

**Ready for Review:** YES for local first-party analytics capture and coordinator integration tests. Production dashboarding and retention policy remain Phase 12/ops scope.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

Adds the Phase 11.6 local scope: integration-style SendCoordinator coverage for terminal transfer pushes and a privacy-first KPI analytics pipeline. iOS records a bounded allowlist of non-PII events to Kolaleaf's own `/api/v1/analytics/events` route using system-origin requests, buffers offline events locally, and flushes on session/app activation. The backend stores only a keyed HMAC user hash plus sanitized allowlisted properties in a new `AnalyticsEvent` table. The route is registered in OpenAPI and exported from the schema barrel.

## Files Changed In This Slice

- `ios/Kolaleaf/Networking/Endpoints/AnalyticsEndpoints.swift` — mobile analytics event contract and property value encoding.
- `ios/Kolaleaf/Domain/Services/AnalyticsService.swift` — first-party analytics client, PII scrubber, offline buffer, and flush.
- `ios/Kolaleaf/App/{Environment+Kola.swift,KolaleafApp.swift}` — process-scoped analytics service injection and lifecycle flushes.
- `ios/Kolaleaf/Features/{Onboarding/WelcomeView.swift,Send/SendView.swift,Send/ReceiptView.swift}` — initial KPI instrumentation on core flow screens/actions.
- `ios/KolaleafTests/Domain/Services/AnalyticsServiceTests.swift` — verifies system-origin posting, scrubbing, and offline flush.
- `ios/KolaleafTests/Features/Send/SendCoordinatorIntegrationTests.swift` — verifies terminal push routing and non-regression after receipt.
- `src/app/api/v1/analytics/events/*` and `src/lib/analytics/events.ts` — authenticated analytics route, Zod/OpenAPI schema, hashing, sanitization, and insert path.
- `prisma/schema.prisma` and `prisma/migrations/20260514083000_analytics_events/migration.sql` — `AnalyticsEvent` storage.
- `src/app/api/v1/openapi/route.ts`, `src/lib/schemas/index.ts`, and `tests/e2e/openapi-endpoint.test.ts` — contract discovery/count updates.

## Validation

- `npm test -- --run tests/app/api/v1/analytics/events.test.ts tests/e2e/openapi-endpoint.test.ts tests/lib/obs/pii-scrubber.test.ts tests/lib/obs/logger.test.ts` — 4 files / 14 tests passed.
- `npx tsc --noEmit` — passed.
- `xcodebuild test -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97' -only-testing:KolaleafTests/SendCoordinatorIntegrationTests -only-testing:KolaleafTests/AnalyticsServiceTests` — 6 tests passed.
- `npm run build` — passed; route list includes `/api/v1/analytics/events`.
- `xcodebuild -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -configuration Debug -destination 'platform=iOS,name=iPhone' -derivedDataPath ios/build/DerivedData build` — passed.
- `xcrun devicectl device install app --device iPhone.coredevice.local /Users/ao/Documents/projects/Kolaleaf/ios/build/DerivedData/Build/Products/Debug-iphoneos/Kolaleaf.app` — installed `com.kolaleaf.app`.
- `xcrun devicectl device process launch --device iPhone.coredevice.local com.kolaleaf.app` — launched.

## Remaining Review Scope

- Migration must run before production analytics writes are enabled.
- Analytics retention, aggregation dashboards, and admin visibility are not included in this slice.
- Current instrumentation intentionally starts with a small safe event set; more events should be added only with property allowlist review.

---

# Review Request -- Wave 2a Phase 11.5 Notification Preferences + PII Scrubber Slice

**Ready for Review:** YES for local notification preference gating and reusable PII scrubber. Sentry package installation/DSN wiring remains Phase 12 production setup.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

Replaces the Security menu's placeholder alert rows with real toggles for new-device sign-in alerts and transfer push notifications. The new-device preference gates the Phase 11.5 device alert before it is shown, and the transfer preference prevents APNs permission prompts when disabled. Backend structured logging now passes payloads through a reusable PII scrubber that redacts sensitive keys, emails, E.164 phone numbers, auth cookies, and bearer tokens while preserving useful diagnostics like dates and sanitized error messages; the same function is exported as `scrubPiiForSentry` for future Sentry `beforeSend` wiring.

## Files Changed In This Slice

- `ios/Kolaleaf/Features/Security/SecurityMenuView.swift` — real notification toggles.
- `ios/Kolaleaf/Domain/Services/PushPermissionService.swift` — shared preference keys and prompt gating.
- `ios/Kolaleaf/App/KolaleafApp.swift` — gates new-device alert by preference.
- `ios/KolaleafTests/Domain/Services/PushPermissionServiceTests.swift` — verifies disabled transfer preference suppresses APNs prompt.
- `src/lib/obs/pii-scrubber.ts` — reusable log/Sentry scrubber.
- `src/lib/obs/logger.ts` — applies scrubber to every structured log payload.
- `tests/lib/obs/pii-scrubber.test.ts` and `tests/lib/obs/logger.test.ts` — scrubber/logger coverage.

## Validation

- `npm test -- --run tests/lib/obs/pii-scrubber.test.ts tests/lib/obs/logger.test.ts` — 6 tests passed.
- `npx tsc --noEmit` — passed.
- `xcodebuild test -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97' -only-testing:KolaleafTests/PushPermissionServiceTests` — 9 tests passed.
- `npm run build` — passed.
- Physical iPhone Debug build/install/launch — passed on `iPhone.coredevice.local`.

## Remaining Review Scope

- Sentry SDK install, DSN/environment wiring, source maps, and release tagging remain Phase 12 production setup.
- Notification preferences are local iOS preferences in this slice; cross-device preference persistence can be added if product wants settings to roam.

---

# Review Request -- Wave 2a Phase 11.5 Device Attestation Slice

**Ready for Review:** YES for local device registration/audit and user alert wiring. Full Apple attestation-object cryptographic verification remains a production hardening item, not claimed here.
**Date:** 2026-05-14
**Branch / worktree:** `feat/ios-swiftui-app` in `/Users/ao/Documents/projects/Kolaleaf`

## Summary

Adds authenticated device-attestation registration after session establishment. iOS generates and persists an App Attest key when supported, posts the key identifier to the backend, and the backend stores only a SHA-256 hash in AuthEvent metadata. Returning devices are recognized from prior `DEVICE_ATTESTED` events; second-and-later new devices trigger `NEW_DEVICE_LOGIN_ALERTED` and a native in-app alert. Unsupported devices/simulators are audited without creating a persistent key.

## Files Changed In This Slice

- `src/app/api/v1/auth/device-attestation/*` — new route, Zod/OpenAPI schema, canonical errors.
- `src/lib/auth/device-attestation.ts` — hashed key registration and new-device detection.
- `tests/app/api/v1/auth/device-attestation.test.ts` — route/service behavior coverage.
- `src/app/api/v1/openapi/route.ts` — imports the new schema for contract output.
- `ios/Kolaleaf/Networking/DTOs/AuthDTOs.swift` and `Endpoints/AuthEndpoints.swift` — iOS request/response contract.
- `ios/Kolaleaf/Domain/Services/ReferralCapture.swift` — App Attest registration service housed in an existing compiled source file.
- `ios/Kolaleaf/App/KolaleafApp.swift`, `AppState.swift`, `RootCoordinator.swift` — post-login registration task and new-device alert.
- `ios/KolaleafTests/App/AppStateTests.swift` — confirms logout clears new-device alert state.

## Validation

- `npm test -- --run tests/app/api/v1/auth/device-attestation.test.ts` — 6 tests passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `xcodebuild test -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97' -only-testing:KolaleafTests/AppStateTests` — 12 tests passed.
- `xcodebuild -project ios/Kolaleaf.xcodeproj -scheme Kolaleaf -configuration Debug -destination 'platform=iOS,name=iPhone' -derivedDataPath ios/build/DerivedData build` — passed.
- `xcrun devicectl device install app --device iPhone.coredevice.local .../Kolaleaf.app` — installed `com.kolaleaf.app`.
- `xcrun devicectl device process launch --device iPhone.coredevice.local com.kolaleaf.app` — blocked because the iPhone was locked; install had already succeeded.

## Remaining Review Scope

- This slice deliberately does not claim full Apple App Attest cryptographic assertion verification. That should be promoted into Phase 12 production hardening if required before external beta.
- Phase 11.5 still needs notification preferences, Sentry PII scrubber/config, and compliance-copy review.

---

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
