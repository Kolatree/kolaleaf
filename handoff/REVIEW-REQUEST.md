# Review Request — Step 15b

**Author:** Bob (Builder)
**Date:** 2026-04-15
**Step:** 15b — FIX-NOW cleanup (items #3, #5, #6, #7, #8, #9 from the Step 15 audit)
**Ready for Review:** YES

---

## Scope

Six items from Arch's FIX-NOW triage that did not land in Step 15a:

| # | Item | Files |
|---|------|-------|
| 3 | `getTransfer` user-safe projection | `src/lib/transfers/queries.ts`, `tests/lib/transfers/queries.test.ts` |
| 5 | Observability on remaining bare catches + worker start/end logs | webhooks×4, rates×2, workers×2 |
| 6 | `RateService` bypass on `/api/rates/public` | `src/lib/rates/rate-service.ts`, `src/lib/rates/index.ts`, `src/app/api/rates/public/route.ts` |
| 7 | TS errors (4 sumsub + 2 queries.test.ts) | `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts`, `tests/lib/transfers/queries.test.ts` |
| 8 | Admin dashboard error banner | `src/components/design/KolaPrimitives.tsx`, `src/app/admin/page.tsx`, `tests/app/admin/page.test.tsx` (new) |
| 9 | Send-page rate-load error surface | `src/app/(dashboard)/send/page.tsx` |

No new dependencies. No migrations. No visual redesign. Decimal preserved for money.

---

## Files changed (read these)

### Item #3 — `getTransfer` projection
- **`src/lib/transfers/queries.ts:1-50`** — added exported `TransferUserView` interface, `USER_SAFE_TRANSFER_SELECT` (typed via `satisfies Prisma.TransferSelect`), and reshaped `getTransfer` to use the explicit select. Stripped fields: `failureReason`, `payoutProviderRef`, `payoutProvider`, `payidProviderRef`, `payidReference`, `retryCount`. `listTransfers` and `getTransferWithEvents` untouched.
- **`tests/lib/transfers/queries.test.ts:62-115`** — 2 new tests in the `getTransfer` describe block: one populates the internal fields then asserts they are absent from the projection; one asserts the recipient projection is the safe `{id, fullName, bankName}` shape.
- **No admin-side changes needed:** admin `[id]` route uses `prisma.transfer.findUniqueOrThrow` directly (`src/app/api/admin/transfers/[id]/route.ts:15-22`), not `getTransfer`. Confirmed via tldr search.

### Item #6 — RateService bypass
- **`src/lib/rates/rate-service.ts:107-130`** — new exported helper `getCurrentRateByPair(base, target)`. Resolves the active corridor by pair, then delegates to `RateService.getCurrentRate(corridorId)`. Returns `{corridor, rate}` or null.
- **`src/lib/rates/index.ts:4`** — re-export the helper.
- **`src/app/api/rates/public/route.ts`** — refactored. Now imports `getCurrentRateByPair`; replaces the two direct prisma calls with a single helper call; bare `} catch {` replaced with logging.
- **`tests/app/api/rates/public.test.ts:129-164`** — new test "honors admin-override rates" verifying that an admin-flagged most-recent rate flows through correctly. The 8 existing tests still pass unchanged because the mock surface (`prisma.rate.findFirst`) is what `RateService.getCurrentRate` calls under the hood.

### Item #5 — Observability
- **`src/app/api/webhooks/{monoova,sumsub,flutterwave,paystack}/route.ts`** — each `} catch {` for the JSON-parse path now `} catch (err)` + `console.error('[webhooks/<provider>] invalid payload', err)`. The main handler catch already logged from Step 15a.
- **`src/app/api/rates/public/route.ts`**, **`src/app/api/rates/[corridorId]/route.ts`** — bare catches → `console.error('[api/rates/...]', err)`.
- **`src/lib/workers/reconciliation.ts:18-104`** — wraps body in try/catch. Logs:
  - start: `[worker/reconciliation] start`
  - success: `[worker/reconciliation] success expired=N flagged=N retried=N`
  - failure: `[worker/reconciliation] failed`, then re-throws.
- **`src/lib/workers/rate-refresh.ts:15-49`** — same start/success/failure pattern. Per-corridor failures also log inside the inner catch.
- All cron routes already had logs from Step 15a — no churn there.

### Item #7 — TS errors
- **`src/lib/kyc/sumsub/__tests__/kyc-service.test.ts:94, 105, 226, 238`** — pass `mockSumsubClient` as the second arg to `initiateKyc`/`retryKyc`. The mock is in scope from the outer describe.
- **`tests/lib/transfers/queries.test.ts:125-127`** — `as Record<string, unknown>` was an unsafe cross-type cast; changed to a two-step `unknown as Record<string, unknown>` with a renamed local (`recipientFields` to avoid colliding with the existing `recipient` from `beforeAll`).
- **Stale `.next/types/validator.ts`** — referenced a deleted `src/app/page.tsx`. Removed `.next/` so tsc's clean baseline is reproducible. Will regenerate on next build.
- Net: `npx tsc --noEmit` now reports 0 errors with NO exclusions.

### Item #8 — Admin dashboard error banner
- **`src/components/design/KolaPrimitives.tsx:438-466`** — new `<AdminAlert tone='warn' | 'error'>` primitive. Inline-style with Variant D tokens. `data-testid="admin-alert"`. `role="alert"` for a11y.
- **`src/app/admin/page.tsx`** — imports `AdminAlert`, computes `partialFailure = statsData === null || floatData === null || ratesData === null`, renders the banner above the rest of the dashboard. Copy: `"Admin data partially unavailable. Check server logs."`
- **`tests/app/admin/page.test.tsx`** (new, 92 lines) — 2 tests:
  1. mocks `fetch` so `/api/admin/stats` returns `ok: false` → asserts the alert text appears in the rendered tree
  2. mocks all three fetches `ok: true` → asserts the alert text is absent
- Uses a small `collectStrings` tree walker because the project does not depend on React Testing Library / jsdom (no new deps allowed). `next/headers` is mocked at the module level so the server component can run under vitest.

### Item #9 — Send-page rate-load
- **`src/app/(dashboard)/send/page.tsx:43-56`** — `fetchRate` now sets `setError('Could not load live rate. Please refresh.')` on both non-OK response and thrown error. On a successful poll, clears the error if and only if it is still that exact rate-load message (so a `handleSend` error from elsewhere is not wiped 60s later).

---

## Verification

```
npx tsc --noEmit         → TypeScript compilation completed (0 errors)
npm test -- --run        → 54 files, 392 tests, 0 failures (baseline 387, +5 new)
```

Targeted suites:
- `tests/lib/transfers/queries.test.ts` — 11/11
- `tests/app/api/rates/public.test.ts` — 9/9
- `tests/app/admin/page.test.tsx` — 2/2 (new)
- `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` — 13/13

Grep audit: zero remaining bare `} catch {` in `src/app/api/{cron,webhooks,rates}` after the change.

---

## Out of scope (per brief)

- Removing `/api/rates/[corridorId]` route — Arch already decided KEEP-and-document.
- Webhook queue/ack split — DEFER to Step 16.
- `RateService` singleton consolidation — Known Gap.
- New HTTP-level cron route tests — DEFER.

---

## Ready for Review: YES

Hand off to Richard. Nothing pending on Bob's side.
