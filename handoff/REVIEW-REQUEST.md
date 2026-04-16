# Review Request -- Step 15j

**Step:** 15j -- Provider hardening (env validation + retry + timeout + idempotency)
**Date:** 2026-04-15
**Builder:** Bob
**Ready for Review:** YES

---

## Summary

Every third-party provider adapter (Sumsub, Monoova, Flutterwave,
Paystack, FX rate) now:

1. Validates env vars on module load — fail-fast in production, mock
   shim in dev/test (pattern mirrors `src/lib/email/client.ts` and
   `src/lib/sms/client.ts`).
2. Routes outbound calls through a single shared `withRetry` helper
   with exponential backoff + jitter and per-attempt `AbortController`
   timeouts.
3. Maps errors to typed `ProviderTimeoutError` /
   `ProviderTemporaryError` / `ProviderPermanentError` so callers can
   reason about retryability uniformly.
4. Passes provider-supported idempotency keys on POSTs
   (Flutterwave + Paystack `Idempotency-Key` header; Monoova natural
   `reference` key; Sumsub natural `externalUserId`).

No handler-level changes. No schema changes. No new deps. The
`PayoutError` subclass surface used by the orchestrator's retry/failover
is preserved.

---

## Files to Review

### New files

- `src/lib/http/retry.ts` -- shared `withRetry(fn, opts)` helper, typed
  errors (`ProviderTimeoutError`, `ProviderTemporaryError`,
  `ProviderPermanentError`), `errorForStatus()` status-code classifier.
- `tests/lib/http/retry.test.ts` -- 12 tests: first-success,
  retry-then-success, exhausted attempts, permanent-no-retry, custom
  `shouldRetry`, AbortSignal timeout translation, native TypeError
  translation, per-attempt signal freshness, `errorForStatus`.

### Modified provider clients

- `src/lib/kyc/sumsub/client.ts` (rewrite) -- `validateSumsubConfig()` +
  module-load `sumsubConfig` constant; `request()` wrapped in
  `withRetry`; errors mapped via `errorForStatus`; `createSumsubClient()`
  throws clearly when creds are absent.
- `src/lib/payments/monoova/client.ts` (rewrite) --
  `validateMonoovaConfig()` + `monoovaConfig`; `createPayId` +
  `getPaymentStatus` wrapped in `withRetry`.
- `src/lib/payments/payout/flutterwave.ts` (rewrite) --
  `validateFlutterwaveConfig()`; `initiatePayout` / `getPayoutStatus` /
  `getWalletBalance` wrapped in `withRetry` with a Flutterwave-tuned
  `shouldRetry` (retries 5xx + 429 + timeout; skips `InvalidBankError` /
  `InsufficientBalanceError`). `Idempotency-Key: <reference>` on POST
  /transfers.
- `src/lib/payments/payout/paystack.ts` (rewrite) --
  `validatePaystackConfig()`; `createRecipient` / `initiatePayout` /
  `getPayoutStatus` wrapped in `withRetry`. `Idempotency-Key:
  <reference>` on POST /transfer.
- `src/lib/rates/fx-fetcher.ts` (rewrite) -- `validateFxConfig()` +
  `fxConfig`; `fetchWholesaleRate` wrapped in `withRetry` with 10s
  default timeout. Errors mapped via `errorForStatus`.

### Modified module roots (re-exports only)

- `src/lib/kyc/sumsub/index.ts` -- adds
  `validateSumsubConfig`, `sumsubConfig`, `SumsubConfig`.
- `src/lib/payments/monoova/index.ts` -- adds
  `validateMonoovaConfig`, `monoovaConfig`, `MonoovaConfig`.
- `src/lib/payments/payout/index.ts` -- adds
  `validateFlutterwaveConfig`, `validatePaystackConfig`.
- `src/lib/rates/index.ts` -- adds `validateFxConfig`, `fxConfig`.

### Modified tests (existing + new cases)

- `src/lib/kyc/sumsub/__tests__/client.test.ts` -- 4xx/5xx now assert
  typed errors; added retry count assertions; new
  `validateSumsubConfig` suite (3 tests).
- `src/lib/payments/monoova/__tests__/client.test.ts` -- same pattern;
  new `validateMonoovaConfig` suite (3 tests).
- `src/lib/payments/payout/__tests__/flutterwave.test.ts` -- uses
  `mockRejectedValue` (persistent) where retry is expected; asserts
  `Idempotency-Key`; new `validateFlutterwaveConfig` suite (3 tests).
- `src/lib/payments/payout/__tests__/paystack.test.ts` -- same pattern;
  new `validatePaystackConfig` suite (3 tests).
- `src/lib/rates/__tests__/fx-fetcher.test.ts` -- updated timeout /
  error-shape expectations; new `validateFxConfig` suite (3 tests).

### Config

- `.env.example` -- documented SUMSUB_*, MONOOVA_*, FLUTTERWAVE_*,
  PAYSTACK_*, FX_* with per-provider idempotency notes and
  dev-vs-production behavior.

---

## Key Decisions

1. **Two `ProviderTimeoutError` classes coexist.** One in
   `src/lib/http/retry.ts` (generic; used by Sumsub, Monoova, FX) and
   one already in `src/lib/payments/payout/types.ts` (extends
   `PayoutError`; feeds the orchestrator's retryable flag). Renaming
   either would churn unrelated code. The Flutterwave retry predicate
   explicitly handles both.
2. **AbortError normalisation.** `withRetry` always converts any
   `DOMException('AbortError')` (ours or the runtime's) into
   `ProviderTimeoutError` so callers never sniff DOMException names.
3. **Idempotency keys per provider (documented in module headers):**
   - Flutterwave: `Idempotency-Key: <params.reference>` header on POST.
   - Paystack: `Idempotency-Key: <params.reference>` header on POST.
   - Monoova: natural key via `reference` field (payIdReference).
   - Sumsub: natural key via `externalUserId` (our userId).
   - FX: GET-only, idempotent by definition.
4. **Test env mutation.** Switched to `vi.stubEnv` +
   `vi.unstubAllEnvs` because Node types `process.env.NODE_ENV` as
   readonly.
5. **No dep additions.** Everything uses native `fetch`,
   `AbortController`, `crypto` (already imported by Sumsub for HMAC).

---

## Open Questions

None. Scope matched the brief; all Phase D checks are green.

---

## Verification

```
$ npx tsc --noEmit
(0 errors, 0 exclusions)

$ npm test -- --run
 Test Files  81 passed (81)
      Tests  595 passed (595)
```

72 of those 595 are the provider + retry tests touched in this step
(12 retry + 11 FX + 10 Flutterwave + 10 Paystack + 14 Sumsub + 15
Monoova) — all green.
