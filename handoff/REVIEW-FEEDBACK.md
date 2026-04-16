# Review Feedback -- Step 15l (FINAL)
Date: 2026-04-16
Ready for Builder: YES

## Must Fix

(none)

## Should Fix

(none)

## Escalate to Architect

(none)

## Cleared

All 20 changed files reviewed line-by-line against the REVIEW-REQUEST and
ARCHITECT-BRIEF Phase A/B spec.

**C1 fix (lazy env validation) -- verified across all 5 provider modules:**

1. `rates/fx-fetcher.ts` -- Import safe: no top-level `validateFxConfig()` call;
   constructor stores config without validating. First-use throws:
   `fetchWholesaleRate` calls `getConfig()` which calls `validateFxConfig()`;
   throws with specific missing-var message in production. Tests:
   `fx-fetcher.test.ts:132-141` (import safe), `fx-fetcher.test.ts:143-149`
   (construction safe), `fx-fetcher.test.ts:151-160` (fetch throws). Logic
   unchanged: retry, timeout, error taxonomy intact.

2. `payments/monoova/client.ts` -- Import safe: no top-level
   `validateMonoovaConfig()` call. First-use throws: `createMonoovaClient()`
   calls `validateMonoovaConfig()` inline; isMock guard throws generic error.
   Tests: `client.test.ts:169-178` (import safe), `client.test.ts:188-193`
   (validate throws). Logic unchanged: `MonoovaHttpClient` class, retry, error
   taxonomy untouched.

3. `kyc/sumsub/client.ts` -- Import safe: no top-level `validateSumsubConfig()`
   call. First-use throws: `createSumsubClient()` calls `validateSumsubConfig()`
   inline; isMock guard throws. Tests: `client.test.ts:258-269` (import safe),
   `client.test.ts:281-288` (validate throws). Logic unchanged:
   `SumsubHttpClient`, HMAC signing, retry, error taxonomy untouched.

4. `email/client.ts` -- Import safe: `process.env` reads at module scope are
   side-effect-free; `assertResendConfig()` exported but not called at load.
   First-use throws: `getResend()` calls `assertResendConfig()`; `sendEmail()`
   also calls it before the dev-log branch so production never silently logs.
   Tests: `send.test.ts:83-92` (import safe), `send.test.ts:94-103`
   (RESEND_API_KEY throws), `send.test.ts:105-114` (EMAIL_FROM throws). Logic
   unchanged: `getResend()`, `getEmailFrom()`, `hasApiKey()` untouched.

5. `sms/client.ts` -- Same pattern as email. Import safe: `process.env` reads at
   module scope. First-use throws: `getTwilio()` calls `assertTwilioConfig()`;
   `sendSms()` calls it before dev-log branch. Tests: `send.test.ts:76-86`
   (import safe), `send.test.ts:88-98` (SID throws), `send.test.ts:100-109`
   (TOKEN throws), `send.test.ts:111-122` (FROM_NUMBER throws). Logic
   unchanged: `getTwilio()`, `getFromNumber()`, `hasTwilioConfig()` untouched.

**M1 fix (deprecation comment) -- verified:**
Text at `src/app/api/rates/[corridorId]/route.ts:1-2` matches the verbatim spec
from ARCHITECT-BRIEF line 212 (line-wrapped for readability, content identical).

**Barrel files -- verified:**
`fxConfig`, `monoovaConfig`, `sumsubConfig` re-exports removed from
`rates/index.ts`, `monoova/index.ts`, `sumsub/index.ts`. Zero dangling
references in `src/` (grep confirmed).

**HANDOVER.md -- verified:**
Reflects full Step 15 journey (15a-15l). Routes map includes all new routes from
15d-k (`/activity/[id]`, `/privacy`, `/terms`, `/compliance-info`, auth
verification, account self-service, 2FA). Decisions-locked section includes lazy
env validation. Next steps are Railway deploy, real provider sandboxes, Wave 2a
iOS.

**BUILD-LOG Known Gaps -- verified:**
All 6 Minor items (m1-m6) and 1 Major (M4) from Phase A are present in the
"Still open" list. M2 absorbed into C1 (correct -- no longer relevant after lazy
validation). M3 dropped (correct -- no new build warning observed). No item from
prior steps was silently dropped. `npm run build` failure is correctly marked
closed in 15l.

**Scope drift -- verified:**
20 files changed. Breakdown: 5 provider modules + 3 barrel files + 5 test files
+ 1 route file + 2 email/sms send files + 4 handoff docs. No surprise files. No
new dependencies. No schema migrations. No API contract changes.

---

Step 15l is clear. Ship it.
