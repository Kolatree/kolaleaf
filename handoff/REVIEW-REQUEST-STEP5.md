# Review Request — Step 5: Flutterwave + Paystack NGN Payout

**Ready for Review: YES**

## Summary

Full payout service layer implementing NGN disbursement via Flutterwave (primary) and Paystack (fallback), with webhook handling, provider failover, and float monitoring. All TDD — tests written first, watched fail, then implemented.

## Files Changed

### New files (src/lib/payments/payout/)

| File | Lines | Purpose |
|------|-------|---------|
| `types.ts` | 1-68 | PayoutProvider interface, error classes, reference generator |
| `flutterwave.ts` | 1-107 | Flutterwave Transfer API client implementing PayoutProvider |
| `paystack.ts` | 1-88 | Paystack Transfer API client implementing PayoutProvider (two-step: recipient + transfer) |
| `orchestrator.ts` | 1-175 | Payout orchestration — initiate, success, failure with retry/failover, manual retry |
| `webhooks.ts` | 1-143 | Webhook handlers for both providers — signature verification, idempotency via WebhookEvent |
| `float-monitor.ts` | 1-72 | Float balance check, pause/resume transfers based on NGN threshold |
| `index.ts` | 1-18 | Barrel export |

### Test files (src/lib/payments/payout/__tests__/)

| File | Tests | Coverage |
|------|-------|----------|
| `flutterwave.test.ts` | 9 | Successful payout, insufficient balance, invalid bank, timeout, rate limit, status check, wallet balance |
| `paystack.test.ts` | 7 | Two-step payout (recipient + transfer), API errors, status check with failure reason |
| `orchestrator.test.ts` | 11 | Happy path, failure retry, FW->PS failover, NEEDS_MANUAL escalation, manual admin retry, state guards |
| `webhooks.test.ts` | 10 | Valid webhooks, duplicate skip (idempotency), invalid signatures, unknown refs, failed transfer routing |
| `float-monitor.test.ts` | 8 | Balance check sufficient/insufficient/exact, pause AUD_RECEIVED, resume FLOAT_INSUFFICIENT, no-op cases |
| **Total** | **45** | |

### Modified files

| File | Change |
|------|--------|
| `src/lib/transfers/transitions.ts:8` | Added `AUD_RECEIVED` as valid target from `FLOAT_INSUFFICIENT` (required for float resume per brief) |
| `tests/lib/transfers/transitions.test.ts:30` | Updated assertion to match new FLOAT_INSUFFICIENT transitions |

## Key Design Decisions

1. **Provider interface consistency** — Both FlutterwaveProvider and PaystackProvider implement the same `PayoutProvider` interface. Paystack's two-step flow (create recipient, then transfer) is encapsulated inside its `initiatePayout`.

2. **Failover logic** — Orchestrator tracks retryCount on the Transfer model. After 3 failures with Flutterwave, resets retryCount and switches to Paystack. After 3 Paystack failures, escalates to NEEDS_MANUAL.

3. **Webhook idempotency** — Both handlers check `WebhookEvent` table (unique on provider+eventId) before processing. Duplicates are silently skipped.

4. **Scoped test cleanup** — Payout tests clean up only their own data (filtered by user name prefix) to avoid destroying seeded corridor data that other test suites depend on.

5. **State machine integration** — All state transitions go through the existing `transitionTransfer()` with optimistic locking. The orchestrator does not bypass the state machine.

## Open Questions

1. The `FLOAT_INSUFFICIENT -> AUD_RECEIVED` transition was added to support the float monitor's resume behavior per the brief. The original transitions only allowed `FLOAT_INSUFFICIENT -> PROCESSING_NGN`. Confirm this is the intended flow.

2. The `foundation.test.ts` test suite has 1 pre-existing failure (expects seeded corridor data that doesn't exist in the test DB). Not caused by Step 5 changes.

## How to Verify

```bash
# Run all payout tests (45 tests)
npm test -- src/lib/payments/payout/

# Run full suite (165/166 pass — 1 pre-existing seed data failure)
npm test
```
