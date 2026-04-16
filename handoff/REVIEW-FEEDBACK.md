# Review Feedback — Step 15j
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `src/lib/rates/fx-fetcher.ts:70` — `FX_API_KEY` is passed as a URL query
  parameter (`...&apikey=${this.config.apiKey}`). URL query strings leak to
  upstream proxies, APM spans, and any telemetry that captures request URLs.
  Pre-existing (not introduced by 15j), but now that the FX adapter is
  hardened it is the weakest link. If the provider supports it, move the key
  to an `Authorization: Bearer` header or `X-API-Key` header. If the provider
  only accepts it via query, scrub the URL from any error/telemetry path.
  Log to BUILD-LOG for Step 15k or wherever Arch routes it.
- `tests/lib/http/retry.test.ts` — no test asserts that `random()` (jitter)
  is invoked by default. Every test passes `random: zeroJitter`, which proves
  the injection point works but not that jitter actually runs. Add one test
  that spies on an injected `random` and asserts it was called once per
  retry sleep. Two-minute fix.
- `src/lib/payments/payout/flutterwave.ts:167` —
  `(body as Record<string, string>).account_bank` is cast unconditionally
  when `body` is possibly undefined (GET paths). It's guarded today because
  `InvalidBankError` is only raised on the POST path that always supplies a
  body, but the cast reads as unsafe. Narrow the type or guard with
  `body && typeof body === 'object'`.

## Escalate to Architect
None.

## Cleared

Reviewed:

- `src/lib/http/retry.ts` — retry/timeout helper, typed error taxonomy.
- `tests/lib/http/retry.test.ts` — 12 tests covering first-success,
  retry-then-success, exhausted attempts, permanent-no-retry, custom
  predicate, AbortSignal timeout translation, native TypeError translation,
  per-attempt signal freshness, and the status-code classifier.
- `src/lib/kyc/sumsub/client.ts` — `validateSumsubConfig()` runs at module
  load (line 85). Production with missing vars throws clearly (line 69).
  `createSumsubClient()` refuses to hand back a client in mock mode
  (line 205). All three methods routed through `withRetry`. Natural
  idempotency via `externalUserId` documented in module header.
- `src/lib/payments/monoova/client.ts` — same pattern as Sumsub.
  `validateMonoovaConfig()` at module load; `createMonoovaClient()` throws
  in mock mode. Natural idempotency via `reference` documented.
- `src/lib/payments/payout/flutterwave.ts` — `Idempotency-Key: <reference>`
  on POST `/transfers` (verified in test line 67). Dual
  `ProviderTimeoutError` classes (payout/types.ts + http/retry.ts) coexist
  cleanly because `flutterwaveShouldRetry` explicitly lists both
  (`ProviderTimeoutError` and `HttpTimeoutError` alias at lines 194-195).
  `PayoutError` surface preserved for the orchestrator.
- `src/lib/payments/payout/paystack.ts` — `Idempotency-Key: <reference>` on
  POST `/transfer`. `createRecipient` is not keyed, but the comment
  correctly notes Paystack's natural idempotency on account_number+bank_code.
- `src/lib/rates/fx-fetcher.ts` — `validateFxConfig()` at module load; GET
  only, no idempotency key needed; 10s timeout.
- Module index re-exports for all four adapters.
- `.env.example` — all five providers documented with production/dev
  behavior and per-provider idempotency notes.
- `package.json` — git diff confirms no new dependencies.
- `src/lib/http/retry.ts` contains zero logging calls — no secret-leak
  surface introduced by the retry layer itself.

Confirmed production fail-fast: every adapter runs `validate*Config()` at
module load (stronger than lazy first-call validation — a bad deploy surfaces
before the first transfer).
