# Review Feedback — Step 15b
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `src/components/design/KolaPrimitives.tsx:449-450` — AdminAlert uses raw `rgba(...)` and `#b00020` literals rather than named tokens. This matches the existing precedent on line 186 (also a raw `#b00020` error color), so it is NOT a blocker. When Variant D eventually gains `colors.warn` / `colors.error` / `colors.warnBg` tokens, fold this in too. Log it, do not fix inline.
- `src/app/(dashboard)/send/page.tsx:54` — client-side `} catch {` without an err binding. Out of scope for #5 (which targeted `api/{cron,webhooks,rates}` and `lib/workers`). Fine to defer; mentioning only so it does not rot.

## Escalate to Architect
None.

## Verified Working

**Item #3 — `getTransfer` projection.**
`USER_SAFE_TRANSFER_SELECT` in `src/lib/transfers/queries.ts:28-41` explicitly enumerates public fields only; `failureReason`, `payoutProviderRef`, `payoutProvider`, `payidProviderRef`, `payidReference`, `retryCount` are absent. `src/app/api/transfers/[id]/route.ts:13` goes through `getTransfer` — projection applied. `src/app/api/admin/transfers/[id]/route.ts:15-22` uses `prisma.transfer.findUniqueOrThrow` directly — admin keeps full data. Two new tests in `tests/lib/transfers/queries.test.ts:62-109` populate the leaky fields and assert they are stripped; recipient projection verified as `{id, fullName, bankName}`.

**Item #6 — RateService bypass.**
`getCurrentRateByPair` at `src/lib/rates/rate-service.ts:117-131` resolves the corridor then delegates to `RateService.getCurrentRate(corridorId)`. `src/app/api/rates/public/route.ts` now imports the helper; the response shape still only exposes `baseCurrency`, `targetCurrency`, `corridorId`, `customerRate`, `effectiveAt`. New test at `tests/app/api/rates/public.test.ts:129-163` asserts admin-override rate surfaces as `customerRate` and that `adminOverride` and `setById` do NOT leak. Note: `RateService.getCurrentRate` is `orderBy effectiveAt desc` — "admin-override ordering" is emergent (admin rates become the newest row via `setAdminRate`), not a separate code path. The test reflects this correctly.

**Item #5 — Observability.**
`tldr search "} catch {" src/app/api/{cron,webhooks,rates}` and `src/lib/workers` — zero bare catches. All webhook JSON-parse and processing catches log with `[webhooks/<provider>]` prefix plus the error object. Rates routes log with `[api/rates/...]`. `src/lib/workers/reconciliation.ts:19,99-101,103-106` logs start / success (with counts) / failure and re-throws. `src/lib/workers/rate-refresh.ts:16,35,46-48,50-53` same pattern plus per-corridor failure logging inside the loop.

**Item #7 — TS errors.**
`npx tsc --noEmit` → "TypeScript compilation completed" (0 errors). `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` at L94, L105, L226, L238 now passes `mockSumsubClient` as the second arg. `tests/lib/transfers/queries.test.ts:106,174` uses two-step `unknown as Record<string, unknown>` cast. Deleted `.next/` — gitignored build artefact, safe; regenerates on next build.

**Item #8 — AdminAlert.**
`KolaPrimitives.tsx:440-469` — `role="alert"`, `data-testid="admin-alert"`, supports `tone='warn'|'error'`, consumes `radius.card` and `spacing.cardPad` tokens. `src/app/admin/page.tsx:53-54,69-73` computes `partialFailure` correctly (null means non-OK response OR thrown request) and renders the alert above stat tiles. Test at `tests/app/admin/page.test.tsx` mocks `next/headers` at module level and walks the React tree via `collectStrings`; both positive and negative cases are covered.

**Item #9 — Send-page rate-load error.**
`src/app/(dashboard)/send/page.tsx:43-56` — both non-OK response and thrown error set `'Could not load live rate. Please refresh.'`. Successful poll clears that error ONLY if it matches that exact message (via functional `setError` with equality check), so a `handleSend` error from elsewhere survives the next rate poll. Behaviour matches the brief.

**Scope audit.**
`git diff --stat HEAD` shows exactly 19 modified files plus one new test directory (`tests/app/admin/`), all on Bob's list. No drift.

**Verification.**
`npx tsc --noEmit` → 0 errors. `npm test -- --run` → 54 files, 392 tests, 0 failures. Matches Bob's claims.

## Cleared
Step 15b (items #3, #5, #6, #7, #8, #9 from the Phase B FIX-NOW triage). Projection prevents user-facing leakage of internal treasury/audit fields. Public rate endpoint now goes through RateService uniformly. Observability is consistent across webhooks, rates, and workers. TS is clean with no exclusions. Admin partial-fetch failures surface visibly. Send-page rate errors surface correctly without wiping unrelated errors. Step 15b is clear.
