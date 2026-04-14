# Review Request — Step 11: Background Workers

**Ready for Review: YES**

## Summary

Built 4 background worker functions and 4 cron API routes for async jobs that run outside the request/response cycle. All workers are pure functions returning report objects. Cron routes are protected by CRON_SECRET bearer token auth.

## Files Changed

### Worker Functions

| File | Lines | What |
|------|-------|------|
| `src/lib/workers/reconciliation.ts` | 1-90 | Daily reconciliation: expires stale AWAITING_AUD (>24h), flags stuck PROCESSING_NGN (>1h) via compliance report, retries stale NGN_RETRY (>30min) |
| `src/lib/workers/rate-refresh.ts` | 1-40 | Refreshes rates for all active corridors via RateService; handles per-corridor failures gracefully |
| `src/lib/workers/staleness-alert.ts` | 1-62 | Checks all corridors for stale rates; returns alerts (12h+) and blocked list (24h+); creates compliance report |
| `src/lib/workers/float-alert.ts` | 1-40 | Checks float balance via FloatMonitor; pauses transfers if low, resumes if restored |
| `src/lib/workers/index.ts` | 1-10 | Barrel export |

### Cron API Routes

| File | Lines | What |
|------|-------|------|
| `src/app/api/cron/reconciliation/route.ts` | 1-16 | POST, CRON_SECRET auth, calls runDailyReconciliation |
| `src/app/api/cron/rates/route.ts` | 1-16 | POST, CRON_SECRET auth, calls refreshAllCorridorRates |
| `src/app/api/cron/staleness/route.ts` | 1-16 | POST, CRON_SECRET auth, calls checkAndAlertStaleness |
| `src/app/api/cron/float/route.ts` | 1-18 | POST, CRON_SECRET auth, calls checkAndAlertFloat (serializes Decimal to string) |

### Test Files

| File | Tests | What |
|------|-------|------|
| `src/lib/workers/__tests__/reconciliation.test.ts` | 7 | Expires stale AWAITING_AUD, skips fresh, flags stuck PROCESSING_NGN, retries stale NGN_RETRY, empty report, multi-category |
| `src/lib/workers/__tests__/rate-refresh.test.ts` | 4 | Refreshes active corridors, skips inactive, handles partial failure, returns rate value |
| `src/lib/workers/__tests__/staleness-alert.test.ts` | 5 | Fresh rates no alerts, 13h alert, 25h alert+blocked, compliance report creation, no-rate blocked |
| `src/lib/workers/__tests__/float-alert.test.ts` | 4 | Sufficient float no action, low float pauses, restored float resumes, threshold value |
| `src/lib/workers/__tests__/cron-routes.test.ts` | 8 | 401 for invalid/missing secret, 200 + worker called for valid secret (all 4 routes) |

## Test Results

```
Test Files  43 passed (43)
     Tests  312 passed (312)
```

30 new tests for Step 11. Zero regressions.

## Key Decisions

1. **Reconciliation flags via compliance report, not status change.** Stuck PROCESSING_NGN transfers get a ComplianceReport row for human review rather than an automatic status transition. The transfer stays in PROCESSING_NGN so the payout provider can still deliver a webhook.

2. **Rate refresh uses DEFAULT_SPREAD env var.** Each corridor could have its own spread in the future, but for now a single default (0.7%) is used, matching the existing RateService pattern.

3. **Float alert serializes Decimal to string in JSON response.** The cron route converts `Decimal` fields to strings before returning JSON, since `Decimal` doesn't serialize natively.

4. **No BullMQ/Redis.** As specified, workers are pure functions. Queue infrastructure deferred to deployment phase.

## Open Questions

None.
