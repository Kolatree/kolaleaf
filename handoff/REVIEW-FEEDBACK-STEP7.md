# Review Feedback -- Step 7: Rate Engine
Date: 2026-04-14
Ready for Builder: YES

## Must Fix

None.

## Should Fix

1. **rate-service.ts:55** -- `setAdminRate` computes implied spread as `1 - (customerRate / wholesaleRate)`. If `wholesaleRate` is zero (bad data, manual entry error), this will throw a Decimal division-by-zero error with an unhelpful message. Add a guard: `if (params.wholesaleRate.isZero()) throw new Error('wholesaleRate cannot be zero')`. This is a boundary input at an admin-facing function.

2. **rate-service.ts:48-68** -- `setAdminRate` does not set the `provider` field, so it defaults to `null` in the database (schema: `provider String?`). This is semantically correct for admin overrides, but it means `getCurrentRate` can return a rate with `provider: null`. Any downstream code that reads `provider` without null-checking will fail. Not a bug today, but worth a comment on the `setAdminRate` method documenting that `provider` is intentionally null for admin rates.

3. **staleness-monitor.ts:47-49** -- The staleness check uses strict `>` comparison (`hoursStale > STALE_ALERT_HOURS`). A rate that is exactly 12.000 hours old is reported as not stale. A rate at 12.001 hours is stale. This is technically correct but worth a code comment confirming the boundary is exclusive, since "12h = alert" in the spec could be read as inclusive. Same for the 24h block threshold on line 49.

4. **fx-fetcher.ts:30** -- The API key is passed as a query parameter in the URL (`&apikey=...`). If this URL gets logged (fetch errors, server access logs, monitoring), the API key leaks. Consider passing it as a header instead (most FX APIs support `Authorization: Bearer <key>` or a custom header). If the target API only supports query parameter auth, add a comment acknowledging the risk.

## Escalate to Architect

None.

## Cleared

- All rate math uses `Decimal` from `decimal.js`. No floats anywhere in the pipeline. Spread stored as decimal fraction (0.007 = 0.7%), consistent with schema `Decimal(8,6)`.
- `FxRateProvider` interface follows the same swappable pattern as `MonoovaClient` and `SumsubClient`. Constructor-injected into `RateService`.
- Staleness thresholds: >12h = stale alert, >24h = block transfers. No rate = treated as blocked. Correct.
- Admin override calculates and stores implied spread for audit trail completeness.
- `getCurrentRate` returns latest rate ordered by `effectiveAt` descending. `getRateHistory` respects limit parameter and orders descending.
- `StalenessMonitor` checks all active corridors independently. `shouldBlockTransfers` works per-corridor.
- Schema: `Rate` model has correct Decimal precision (`@db.Decimal(12,6)` for rates, `@db.Decimal(8,6)` for spread). `provider` is nullable (correct for admin overrides). `setById` is nullable (only set for admin rates).
- Test coverage: 38 tests across 4 files. Rate-service and staleness-monitor tests hit the real database (integration tests). Spread tests verify no floating-point artifacts. All 236 tests pass.
- No cron, no API routes -- service layer only as specified.
