# Review Request -- Step 15l

**Step:** 15l -- Final wholistic audit + fix pass (capstone)
**Date:** 2026-04-16
**Builder:** Bob
**Ready for Review:** YES

---

## What Changed

Two fixes from the capstone audit (Phase A findings in `ARCHITECT-BRIEF.md`):

### C1 Fix: Lazy env validation (build-time safety)

**Problem:** `npm run build` failed in production mode. Five provider modules
threw at module-load time when env vars were absent. Next.js 16 evaluates API
route modules with `NODE_ENV=production` during page-data collection, causing
the build to abort before any pages are produced. Deploy to Railway was
impossible.

**Fix:** Moved env validation from import-time to first-use-time across all
five modules. Fail-fast semantics preserved -- the server still throws at
runtime with the specific missing-variable-name error. Only the timing changed
(first provider call, not module evaluation).

Files changed with line ranges:

| File | Lines | Change |
|------|-------|--------|
| `src/lib/rates/fx-fetcher.ts` | 26-73 | Removed `export const fxConfig = validateFxConfig()`. Added `getConfig()` lazy memo in `DefaultFxRateProvider`. `fetchWholesaleRate` calls `getConfig()` instead of `this.config`. |
| `src/lib/rates/index.ts` | 1 | Dropped `fxConfig` re-export. |
| `src/lib/payments/monoova/client.ts` | 9-23, 70-72, 162-173 | Removed `export const monoovaConfig = validateMonoovaConfig()`. `createMonoovaClient()` calls `validateMonoovaConfig()` inline. Header updated. |
| `src/lib/payments/monoova/index.ts` | 2 | Dropped `monoovaConfig` re-export. |
| `src/lib/kyc/sumsub/client.ts` | 84-85, 203-211 | Removed `export const sumsubConfig = validateSumsubConfig()`. `createSumsubClient()` calls `validateSumsubConfig()` inline. |
| `src/lib/kyc/sumsub/index.ts` | 2 | Dropped `sumsubConfig` re-export. |
| `src/lib/email/client.ts` | 1-46 | Replaced top-level `if (isProduction) throw` with exported `assertResendConfig()`. `getResend()` calls it at first use. |
| `src/lib/email/send.ts` | 1, 29-31 | Imports + calls `assertResendConfig()` before dev-log fallback. |
| `src/lib/sms/client.ts` | 1-50 | Same pattern: exported `assertTwilioConfig()`. `getTwilio()` calls it. |
| `src/lib/sms/send.ts` | 1, 32-34 | Imports + calls `assertTwilioConfig()` before dev-log fallback. |

### M1 Fix: Deprecation comment

| File | Lines | Change |
|------|-------|--------|
| `src/app/api/rates/[corridorId]/route.ts` | 1-2 | Added: `// DEPRECATED: kept for internal/admin use. New code should call /api/rates/public?base=...&target=... or use rateService directly.` |

---

## Tests Changed

| File | Change |
|------|--------|
| `src/lib/rates/__tests__/fx-fetcher.test.ts` | +3 new tests in `fx-fetcher build-time safety` block: import safe, construction safe, fetchWholesaleRate throws with specific message. |
| `src/lib/payments/monoova/__tests__/client.test.ts` | +1 new test in `monoova client build-time safety`: import safe. |
| `src/lib/kyc/sumsub/__tests__/client.test.ts` | +1 new test in `sumsub client build-time safety`: import safe. |
| `tests/lib/email/send.test.ts` | Replaced 1 import-throws test with 1 import-safe + 2 send-throws (RESEND_API_KEY, EMAIL_FROM). Net +2. |
| `tests/lib/sms/send.test.ts` | Replaced 3 import-throws tests with 1 import-safe + 3 send-throws (one per var). Net +1. |

Total: 599 baseline -> 607 tests. All green.

---

## Verification

```
npx tsc --noEmit        -> 0 errors
npm test -- --run       -> 82 files / 607 tests passed
npm run build           -> 53 routes generated, 0 errors, 0 warnings
                           (was FAILING before this step)
git status              -> clean (pending this commit)
```

---

## Review Checklist

- [ ] `npm run build` succeeds (the primary deliverable of this step)
- [ ] Lazy validation preserves fail-fast: `validateFxConfig()` still throws in prod with missing vars when called
- [ ] `sendEmail()` + `sendSms()` do NOT silently log in production with missing creds
- [ ] No new dependencies introduced
- [ ] No schema migrations
- [ ] API contracts unchanged (no response shape changes)
- [ ] `fxConfig` / `monoovaConfig` / `sumsubConfig` top-level exports removed from barrels
- [ ] Deprecation comment on `/api/rates/[corridorId]` matches Arch's spec verbatim
- [ ] Known Gaps in BUILD-LOG refreshed to final state
