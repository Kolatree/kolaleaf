# Review Request — Step 7: Rate Engine

**Ready for Review: YES**

## Summary

Built the complete rate engine: automated FX rate fetching, spread calculation, rate persistence, admin override, and staleness monitoring. Full TDD — 38 tests written first, all passing.

## Files Changed

### Source files (4)

| File | Lines | Description |
|------|-------|-------------|
| `src/lib/rates/fx-fetcher.ts` | 1-57 | `FxRateProvider` interface + `DefaultFxRateProvider` implementation. Provider-agnostic — reads `FX_API_KEY` and `FX_API_URL` from env. Handles timeout, HTTP errors, invalid responses. |
| `src/lib/rates/spread.ts` | 1-26 | `calculateCustomerRate(wholesale, spread)` and `calculateReceiveAmount(send, rate)`. Pure Decimal math, no floats. |
| `src/lib/rates/rate-service.ts` | 1-97 | `RateService` class: `getCurrentRate`, `refreshRate`, `setAdminRate`, `isRateStale`, `getRateHistory`. Uses FxRateProvider + spread calculator. Stores rates via Prisma. |
| `src/lib/rates/staleness-monitor.ts` | 1-62 | `StalenessMonitor` class: `checkAllCorridorStaleness` (all active corridors), `shouldBlockTransfers` (single corridor, >24h = block). |

### Barrel export (1)

| File | Description |
|------|-------------|
| `src/lib/rates/index.ts` | Exports `DefaultFxRateProvider`, `FxRateProvider` (type), `calculateCustomerRate`, `calculateReceiveAmount`, `RateService`, `StalenessMonitor`. |

### Test files (4)

| File | Tests | Description |
|------|-------|-------------|
| `src/lib/rates/__tests__/fx-fetcher.test.ts` | 7 | Mock fetch: success, HTTP error, missing rates, null rates, timeout, network error. |
| `src/lib/rates/__tests__/spread.test.ts` | 10 | Spread application, zero/large/tiny spread, rounding, receive amount, float safety. |
| `src/lib/rates/__tests__/rate-service.test.ts` | 12 | DB integration: getCurrentRate, refreshRate, admin override, staleness (fresh, 12h boundary, 13h+, no rates), history ordering + limit. |
| `src/lib/rates/__tests__/staleness-monitor.test.ts` | 9 | DB integration: fresh/stale/blocked rates, multi-corridor independence, shouldBlockTransfers at each threshold, no-rate handling. |

**Total: 38 tests, all passing.**

## Key Decisions

1. **`FxRateProvider` interface** — same swappable pattern as `PayoutProvider`. Constructor-injected into `RateService`.
2. **Spread stored as decimal fraction** (0.007 = 0.7%), consistent with schema `Decimal(8,6)`.
3. **Staleness thresholds**: >12h = stale alert data, >24h = block transfers. No rate = treated as blocked.
4. **Admin override** calculates implied spread from `1 - (customerRate / wholesaleRate)` so audit trail is complete.
5. **`refreshRate` takes spread as parameter** — corridor-level spread config is a future concern (Step 11 or admin dashboard). Keeps the service focused.
6. **No cron/API routes** — service layer only, as specified in the brief.

## Test Evidence

```
npm test → 236 passed, 0 failed (30 test files)
Rate engine tests → 38 passed, 0 failed (4 test files)
```

## Open Questions

None. Brief was clear and implementation is complete.
