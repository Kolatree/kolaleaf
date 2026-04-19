---
title: End-to-end testable transaction flow with BudPay+Flutterwave payout stack
type: feat
status: active
date: 2026-04-19
origin: null
---

# End-to-end testable transaction flow with BudPay+Flutterwave payout stack

## Overview

Kolaleaf's Wave 1 transaction flow cannot be exercised end-to-end today: Sumsub / Monoova / payout provider API keys are not yet available, and two wiring gaps leave every transfer stuck in `CREATED` or `AUD_RECEIVED`. Additionally, the payout provider hierarchy is changing: **BudPay becomes the primary disburser** with **Flutterwave as fallback**, and **Paystack is removed entirely** (code, schema, webhook route, reconciliation client, marketing copy). This plan closes the wiring gaps, performs the provider swap, and adds stub provider paths so the full `CREATED → COMPLETED` lifecycle is clickable in dev — while leaving signature verification, idempotency, audit logging, and AUSTRAC reporting untouched.

## Problem Frame

- Transfer creation works; the `CREATED` row is inert by design.
- `generatePayIdForTransfer` has no caller — nothing advances `CREATED → AWAITING_AUD`.
- `handlePaymentReceived` transitions `AWAITING_AUD → AUD_RECEIVED` but does **not** kick off payout; `orchestrator.initiatePayout` is only called from admin retry paths.
- `MonoovaHttpClient` sends `Authorization: Bearer <key>` but Monoova's real API expects **HTTP Basic** (username = API key, password blank). Will 401 the day real keys land.
- `FlutterwaveProvider` has dev-mode stubs for `listBanks` + `resolveAccount` but **not** for `initiatePayout` / `getPayoutStatus`. Without keys, payout 401s.
- `createMonoovaClient` throws when `MONOOVA_API_KEY` is absent — no stub path at all.
- Paystack is currently the fallback provider (`PaystackProvider`, `handlePaystackWebhook`, `/api/webhooks/paystack`, `paystack-statement-client.ts`, `PayoutProvider` enum value, marketing copy). Product decision: **remove**. Replace with BudPay as primary, push Flutterwave to fallback.

Result: the team cannot test the backbone feature without sandbox credentials, and carries a provider the business no longer plans to use.

## Requirements Trace

- R1. Full transaction flow (`CREATED → AWAITING_AUD → AUD_RECEIVED → PROCESSING_NGN → NGN_SENT → COMPLETED`) must be exercisable in dev/staging with **zero** outbound network calls.
- R2. All state transitions must continue to go through `transitionTransfer()` so `TransferEvent` rows, AUSTRAC reports, velocity checks, and security anomaly checks all fire.
- R3. Signature verification and `WebhookEvent` idempotency must not be bypassed — any stub path plugs in **above** those layers.
- R4. A single env flag `KOLA_USE_STUB_PROVIDERS=true` activates stub mode across all providers. Flag must hard-error at factory construction if `NODE_ENV=production`.
- R5. `MonoovaHttpClient` must send `Authorization: Basic <base64(user:)>` so sandbox keys drop in without a code change.
- R6. A user-facing trigger exists for `CREATED → AWAITING_AUD`.
- R7. A dev/admin-gated trigger exists for `AWAITING_AUD → AUD_RECEIVED` that, in stub mode, cascades to `COMPLETED`.
- R8. **Paystack is fully removed** from src, tests, Prisma enum, webhook routes, reconciliation, and marketing copy. A Prisma migration renames the `PAYSTACK` enum value to `BUDPAY`.
- R9. **BudPay is the primary payout provider**; **Flutterwave is the fallback**. Orchestrator failover flow is `BUDPAY → FLUTTERWAVE → NEEDS_MANUAL` (reverse of today).
- R10. TDD discipline: every new unit starts with a failing test; full vitest suite + `tsc --noEmit` must be green at the end.

## Scope Boundaries

- **Out of scope:** Sumsub integration (`KOLA_DISABLE_KYC_GATE` already shipped), UI screens for the new routes, real provider credential onboarding, historical-transfer-data migration (pre-production → no production rows reference `PAYSTACK`).
- **Not a refactor:** We do not reshape `PayoutOrchestrator` internals, the state machine, or webhook handler idempotency. Additions and the provider swap are surgical.
- **No new runtime deps.** No Vercel Workflow / DurableAgent — we deploy to Railway and already have BullMQ for webhook dispatch; payout is called inline from `handlePaymentReceived` because the call already runs in the webhook worker.
- **No marketing redesign.** We only swap Paystack's name for BudPay in existing copy; layout and trust-logo assets are untouched.

## Context & Research

### Relevant Code and Patterns

- `src/lib/payments/monoova/client.ts` — `MonoovaClient` interface, `MonoovaHttpClient`, `createMonoovaClient`. Pattern: lazy factory validation, `isMock` flag.
- `src/lib/payments/monoova/payid-service.ts` — `generatePayIdForTransfer` (bypassable via `KOLA_DISABLE_KYC_GATE`) and `handlePaymentReceived`.
- `src/lib/payments/payout/flutterwave.ts` — **reference pattern for in-adapter stubs**. `listBanks` + `resolveAccount` check `this.config.secretKey` and return deterministic dev data when absent. Apply the same pattern to `initiatePayout` + `getPayoutStatus` for both BudPay and Flutterwave.
- `src/lib/payments/payout/paystack.ts` — to be deleted. Structure mirrors `flutterwave.ts`; its test is the closest template for the new `budpay.ts` test.
- `src/lib/payments/payout/orchestrator.ts` — `initiatePayout`, `handlePayoutSuccess`, `handlePayoutFailure`, `handleManualRetry`. Swap `PaystackProvider` → `BudPayProvider`; reverse primary/fallback order; rename failover metadata string `toProvider: 'PAYSTACK'` → `'BUDPAY'` accordingly (and orientation: primary failing over now means `BUDPAY → FLUTTERWAVE`).
- `src/lib/payments/payout/webhooks.ts` — `handleFlutterwaveWebhook` stays; `handlePaystackWebhook` → `handleBudPayWebhook`.
- `src/lib/payments/payout/types.ts` — `PayoutProvider.name: 'FLUTTERWAVE' | 'PAYSTACK'` → `'BUDPAY' | 'FLUTTERWAVE'`.
- `src/lib/payments/payout/verify-signature.ts` — `verifyPaystackSignature` (HMAC-SHA512) → `verifyBudPaySignature` (HMAC-SHA512 per BudPay docs reference).
- `src/lib/reconciliation/paystack-statement-client.ts` → `budpay-statement-client.ts` (thin adapter for reconciliation statement pulls).
- `src/lib/queue/webhook-dispatcher.ts` — `WebhookProvider` union type: `'paystack'` → `'budpay'`.
- `src/workers/webhook-worker.ts` — Paystack case → BudPay case (handler + signature verifier wiring).
- `src/app/api/webhooks/paystack/route.ts` → `src/app/api/webhooks/budpay/route.ts`.
- `src/app/api/cron/provider-reconciliation/route.ts` — enumerate providers; Paystack → BudPay.
- `src/app/_components/landing-page.tsx`, `src/app/(marketing)/privacy/page.tsx` — marketing mentions.
- `prisma/schema.prisma` lines 49–52: `enum PayoutProvider { FLUTTERWAVE; PAYSTACK }` → `{ BUDPAY; FLUTTERWAVE }`.
- `src/app/api/v1/admin/transfers/[id]/retry/route.ts` — template for admin routes: `requireAdmin`, `params: Promise<{id}>`, error-class → HTTP mapping, `logAuthEvent`, OpenAPI in `_schemas.ts`.
- `src/app/api/v1/transfers/route.ts` — user-authenticated endpoint shape; `KycNotVerifiedError → 403` mapping reusable.
- `src/lib/kyc/flag.ts` — just-shipped precedent for a single-purpose env-flag helper.

### Institutional Learnings

- `handoff/WAVE-1-AUDIT.md` gap #18 — KYC guard belongs at `generatePayIdForTransfer` (AUSTRAC money-handler boundary). Stub mode must not re-introduce the gap in production; factory must hard-fail on `NODE_ENV=production`.
- The `FLUTTERWAVE_SECRET_KEY`-missing pattern logs a single-shot dev notice. Keep that ergonomic on the BudPay adapter.
- Wave 1 is pre-production; renaming the Prisma enum value is safe because no real `Transfer` row references `PAYSTACK` yet. Dev DBs can be reset or rows force-deleted.

### External References

- **Monoova JS SDK** (sdks-io/monoova-js-sdk): sandbox `https://api.m-pay.com.au/`, prod `https://api.mpay.com.au/`, auth is HTTP Basic (username = API key, password blank). Drives Unit 2.
- **BudPay API** (https://devs.budpay.com/):
  - Single payout: `POST /api/v2/bank_transfer`, Bearer auth, body `{ currency, amount, bank_code, bank_name, account_number, narration, metadata }`.
  - Response: `{ reference, currency, amount, fee, bank, account_number, narration, status, ... }` — `reference` is the provider's transfer ID.
  - Bank list: `GET /api/v2/bank_list` (NGN).
  - Verify payout: `GET /api/v2/verify-payout/:reference` (or similar).
  - Webhooks: HMAC-SHA512 signature (per BudPay docs). Events carry the same `reference` field for correlation. Payload includes `reference, status ('success' | 'failed' | 'pending'), amount, currency, fee`.
  - Sandbox keys via BudPay dashboard after signup.

## Key Technical Decisions

- **Replace Paystack with BudPay in one bounded unit** (Unit 0) before layering on stub work. Reason: every downstream unit references `PayoutProvider.name` and the Prisma enum; doing the swap first means the rest of the plan writes new code against the final shape rather than Paystack-first then refactored.
- **In-adapter stubs for BudPay and Flutterwave `initiatePayout` / `getPayoutStatus`**, mirroring the existing `listBanks`/`resolveAccount` dev stubs on `FlutterwaveProvider`. Avoids a separate `StubPayoutProvider` class and keeps parity.
- **Separate `StubMonoovaClient` class** for Monoova — `MonoovaHttpClient` is a thin HTTP wrapper, and `MonoovaClient` is already an interface (for testing), so a second implementation is cleaner than branching every method.
- **Inline `orchestrator.initiatePayout` inside `handlePaymentReceived`**, not a BullMQ job. `handlePaymentReceived` already runs inside the webhook worker, which already has BullMQ retries + backoff. Adding a second queue would double the retry math without adding durability.
- **Stub-mode payout success is synthesized by the caller**, not by the webhook handler. After a stub `initiatePayout` returns, `orchestrator.handlePayoutSuccess` is invoked immediately. Real webhook paths stay untouched.
- **Flag semantics:** `KOLA_USE_STUB_PROVIDERS=true` forces stubs regardless of whether keys are present. Flag off + missing keys = stub mode in dev/test, hard error in production.
- **Route auth:**
  - `/api/v1/transfers/:id/issue-payid` → `requireAuth` + `requireEmailVerified` + owner check on `transfer.userId`.
  - `/api/v1/admin/transfers/:id/simulate-payment` → `requireAdmin` + dual-guard that returns 404 if `NODE_ENV=production` and flag is off.
- **Prisma enum migration:** the cleanest Postgres path is `ALTER TYPE "PayoutProvider" RENAME VALUE 'PAYSTACK' TO 'BUDPAY'`, then a second migration (if desired) reorders values for ergonomics. Renaming-not-recreating preserves any existing historical `Transfer.payoutProvider` values (there are none in prod, but this is the defensive shape).
- **Idempotency key for BudPay:** use our internal `reference` as before (Flutterwave pattern). If BudPay does not accept an `Idempotency-Key` header, natural dedup lives at the orchestrator layer via `payoutProviderRef` uniqueness.

## Open Questions

### Resolved During Planning

- **Q: BullMQ payout queue vs inline call?** → Inline. Existing webhook worker already provides retries.
- **Q: How does stub mode surface success for reconciliation?** → Stub `getPayoutStatus` returns `SUCCESSFUL`; `STUB-` prefix marks these as synthetic in DB.
- **Q: Do we preserve historical Paystack transfers?** → No production rows exist yet. Wave 1 is pre-launch. Rename enum value in place; any local-dev rows are disposable.
- **Q: BudPay primary + Flutterwave fallback, do retry counts change?** → No. Existing `MAX_RETRIES = 3` semantics apply; only the primary/fallback identities swap.

### Deferred to Implementation

- **Exact BudPay webhook payload field names.** Docs page returned empty to WebFetch (SPA). Implementer should verify against the live devs.budpay.com doc and log any deltas; the skeleton follows Paystack's shape, which is a safe analog.
- **Whether BudPay `bank_list` should replace `NG_BANKS_FALLBACK`.** For now keep the Flutterwave-provided hardcoded list for dev fallback; implementer may add a BudPay-sourced dev notice later.
- **OpenAPI registry refresh.** Register new routes; run the generator if the repo has one.
- **Frontend wiring of the new `issue-payid` button.** Follow-up plan.
- **Marketing page copy final wording.** "BudPay + Flutterwave" vs "Multi-provider payout" — let the product owner decide; implementer swaps Paystack→BudPay verbatim and flags the line for content review.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
User clicks "Send"
     │
     ▼
POST /api/v1/transfers                           (existing, unchanged)
     │  → createTransfer()  → CREATED
     ▼
[new] POST /api/v1/transfers/:id/issue-payid     (Unit 5)
     │  → generatePayIdForTransfer(id, createMonoovaClient())
     │         ├─ real keys  → MonoovaHttpClient (Basic auth, Unit 1)
     │         └─ stub mode → StubMonoovaClient (Unit 2)
     │  → AWAITING_AUD
     ▼
── real Monoova webhook OR ──
[new] POST /api/v1/admin/transfers/:id/simulate-payment  (Unit 6)
     │  → handlePaymentReceived()
     │       ├─ AUD_RECEIVED transition (existing)
     │       ▼
     │   [new] orchestrator.initiatePayout()    (Unit 4)
     │       ├─ real keys → BudPayProvider.initiatePayout   (primary, Unit 0+3)
     │       ├─ on BudPay failure after MAX_RETRIES → FlutterwaveProvider (fallback)
     │       └─ stub mode → in-adapter stub returns fake providerRef (Unit 3)
     │       ▼
     │   PROCESSING_NGN
     │       ├─ real webhook: handleBudPayWebhook / handleFlutterwaveWebhook → handlePayoutSuccess
     │       └─ stub mode: caller invokes handlePayoutSuccess immediately (Unit 4)
     │       ▼
     │   NGN_SENT → COMPLETED
```

All `[new]` items are this plan. Every transition still flows through `transitionTransfer()`.

## Implementation Units

- [ ] **Unit 0: Replace Paystack with BudPay**

**Goal:** Swap Paystack for BudPay across code, schema, webhook route, reconciliation, and marketing copy. BudPay becomes primary, Flutterwave becomes fallback.

**Requirements:** R8, R9.

**Dependencies:** None (foundational — must land before stub work).

**Files:**
- Create: `src/lib/payments/payout/budpay.ts` (mirror of `flutterwave.ts` shape, BudPay API semantics)
- Create: `src/lib/payments/payout/__tests__/budpay.test.ts`
- Create: `src/app/api/webhooks/budpay/route.ts`
- Create: `src/lib/reconciliation/budpay-statement-client.ts`
- Create: `prisma/migrations/<timestamp>_payout_provider_paystack_to_budpay/migration.sql`
- Modify: `prisma/schema.prisma` (rename enum value `PAYSTACK` → `BUDPAY`)
- Modify: `src/lib/payments/payout/types.ts` (`PayoutProvider.name` union)
- Modify: `src/lib/payments/payout/orchestrator.ts` (primary = `BudPayProvider`, fallback = `FlutterwaveProvider`; failover metadata strings; `getOrchestrator()` factory env vars: `BUDPAY_SECRET_KEY`, `BUDPAY_API_URL`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_API_URL`)
- Modify: `src/lib/payments/payout/webhooks.ts` (delete `handlePaystackWebhook`, add `handleBudPayWebhook` following same idempotency pattern)
- Modify: `src/lib/payments/payout/verify-signature.ts` (rename `verifyPaystackSignature` → `verifyBudPaySignature`)
- Modify: `src/lib/payments/payout/index.ts` (exports)
- Modify: `src/lib/payments/payout/__tests__/orchestrator.test.ts` (update provider mocks + failover assertions to reflect new order)
- Modify: `src/lib/payments/payout/__tests__/webhooks.test.ts` (Paystack tests → BudPay)
- Modify: `src/lib/queue/webhook-dispatcher.ts` (`WebhookProvider`: `'paystack'` → `'budpay'`)
- Modify: `src/workers/webhook-worker.ts` (case `'paystack'` → `'budpay'`; signature verifier wiring)
- Modify: `src/app/api/cron/provider-reconciliation/route.ts` (provider enumeration)
- Modify: `src/lib/reconciliation/diff.ts` + `types.ts` (provider names)
- Modify: `src/app/_components/landing-page.tsx` (marketing copy)
- Modify: `src/app/(marketing)/privacy/page.tsx` (vendor list)
- Modify: `prisma/seed.ts` (if any Paystack seed data)
- Delete: `src/lib/payments/payout/paystack.ts`
- Delete: `src/lib/payments/payout/__tests__/paystack.test.ts`
- Delete: `src/lib/reconciliation/paystack-statement-client.ts`
- Delete: `src/app/api/webhooks/paystack/route.ts`

**Approach:**
- `BudPayProvider implements PayoutProvider` with `name: 'BUDPAY'`. Methods:
  - `initiatePayout`: `POST /api/v2/bank_transfer` with Bearer auth, body `{ currency, amount, bank_code, bank_name, account_number, narration: 'Kolaleaf payout to <name>', metadata: { reference } }`. Returns `{ providerRef: response.reference, status: response.status }`.
  - `getPayoutStatus`: `GET /api/v2/verify-payout/:reference` (or the verified equivalent). Returns `{ status, failureReason? }`.
  - Error mapping: HTTP 429 → `RateLimitError`, "insufficient balance" in message → `InsufficientBalanceError`, "invalid bank" → `InvalidBankError`, 5xx → retryable `PayoutError`, 4xx non-matching → permanent `PayoutError`.
  - `withRetry` + `budpayShouldRetry` predicate, structurally identical to `flutterwaveShouldRetry`.
- `handleBudPayWebhook`: HMAC-SHA512 over raw body keyed on webhook secret; `WebhookEvent` row keyed on `reference` (not `transfer_code` like Paystack); call `orchestrator.handlePayoutSuccess` on `status='success'`, `handlePayoutFailure` on `status='failed'`.
- `PayoutOrchestrator.getOrchestrator()` instantiates `BudPayProvider` as primary and `FlutterwaveProvider` as fallback. Failover metadata reads `{ failover: true, fromProvider: 'BUDPAY', toProvider: 'FLUTTERWAVE' }`.
- Prisma migration: single `ALTER TYPE "PayoutProvider" RENAME VALUE 'PAYSTACK' TO 'BUDPAY';`. After running `prisma generate`, `enums.ts` and `class.ts` regenerate.
- Marketing copy: literal Paystack→BudPay replacement; flag to product owner in the commit message for content review.

**Execution note:** Test-first on BudPayProvider + webhooks. The orchestrator test rewrite needs careful attention to the retry-count math — read the existing Paystack path and re-author mirror cases.

**Patterns to follow:** `src/lib/payments/payout/flutterwave.ts` end-to-end — structure, error mapping, idempotency header, `withRetry` usage, dev-notice pattern.

**Test scenarios:**
- Happy path: `BudPayProvider.initiatePayout` with valid params calls `POST /api/v2/bank_transfer` with correct body + Bearer header, returns `{ providerRef, status }` from response.
- Happy path: `handleBudPayWebhook` on `status='success'` calls `orchestrator.handlePayoutSuccess(transferId)` and marks the `WebhookEvent` processed.
- Happy path: `handleBudPayWebhook` on `status='failed'` calls `orchestrator.handlePayoutFailure(transferId, reason)`.
- Error path: BudPay 401 → permanent `PayoutError`, not retried.
- Error path: BudPay 429 → `RateLimitError`, retried per `withRetry`.
- Error path: BudPay response body with `insufficient balance` → `InsufficientBalanceError`, not retried.
- Idempotency: duplicate webhook for same `reference` → handler returns without re-calling orchestrator (existing `WebhookEvent` unique-constraint pattern).
- Orchestrator failover: BudPay fails `MAX_RETRIES` times → transfer moves to `NGN_RETRY → PROCESSING_NGN` with `payoutProvider='FLUTTERWAVE'` and `retryCount=0`.
- Orchestrator failover: Flutterwave then also exhausts → transfer moves to `NEEDS_MANUAL` with `exhaustedProviders=['BUDPAY','FLUTTERWAVE']`.
- Integration: a transfer created fresh, run through the full orchestrator happy path, ends with `payoutProvider='BUDPAY'`.
- Edge case: `WebhookProvider` type union rejects `'paystack'` at compile time (delete test or convert to a positive `'budpay'` assertion).
- Smoke: Prisma client builds and `await prisma.transfer.findFirst({ where: { payoutProvider: 'BUDPAY' } })` type-checks.

**Verification:**
- `npx prisma migrate dev --name payout_provider_paystack_to_budpay` runs cleanly locally.
- Full vitest suite green after regeneration.
- `grep -r "paystack\|PAYSTACK\|Paystack" src/ prisma/` returns zero hits (allowing only references inside `prisma/migrations/` history — those are immutable audit records).
- `tsc --noEmit` clean.

---

- [ ] **Unit 1: `MonoovaHttpClient` Basic Auth alignment**

**Goal:** Swap `Authorization: Bearer <key>` for `Authorization: Basic <base64(username:)>` per Monoova's real API.

**Requirements:** R5.

**Dependencies:** None (parallelisable with Unit 0 if worktrees allow).

**Files:**
- Modify: `src/lib/payments/monoova/client.ts`
- Modify: `src/lib/payments/monoova/__tests__/client.test.ts`

**Approach:**
- `MonoovaHttpClient` computes the Basic header once in the constructor: `'Basic ' + Buffer.from(apiKey + ':').toString('base64')`.
- No interface change; only the header string differs.

**Execution note:** Test-first — update the existing client test to assert the Basic header before touching the implementation.

**Patterns to follow:** Keep `request()` shape identical; Bearer → Basic swap only.

**Test scenarios:**
- Happy path: constructor with `apiKey='abc'` → outbound request has `Authorization: Basic <base64("abc:")>`.
- Happy path: `createPayId` success response still parses to `{ payId, payIdReference }`.
- Error path: 401 response still surfaces as the existing typed error via `errorForStatus`.

**Verification:** Existing `client.test.ts` suite green; new Basic-header assertion passes.

---

- [ ] **Unit 2: `StubMonoovaClient` + factory switch**

**Goal:** A zero-network `MonoovaClient` implementation activated by `KOLA_USE_STUB_PROVIDERS=true` or by missing keys in non-production.

**Requirements:** R1, R4.

**Dependencies:** None for file creation; reads `KOLA_USE_STUB_PROVIDERS` flag helper (created below in Unit 3a if not already present — define it at the top of Unit 2's first file).

**Files:**
- Create: `src/lib/payments/flag.ts` (shared flag helper — small enough to co-locate)
- Create: `src/lib/payments/__tests__/flag.test.ts`
- Create: `src/lib/payments/monoova/stub-client.ts`
- Modify: `src/lib/payments/monoova/client.ts` (new branch in `createMonoovaClient`)
- Modify: `src/lib/payments/monoova/index.ts` (export the stub)
- Test: `src/lib/payments/monoova/__tests__/stub-client.test.ts`
- Test: `src/lib/payments/monoova/__tests__/client.test.ts` (new factory-branch cases)

**Approach:**
- `src/lib/payments/flag.ts`:
  - `isStubProvidersEnabled()` → `process.env.KOLA_USE_STUB_PROVIDERS === 'true'`.
  - `assertStubProvidersSafe()` → throws when flag is on AND `NODE_ENV === 'production'`.
- `StubMonoovaClient implements MonoovaClient`:
  - `createPayId({ transferId, amount, reference })` → `{ payId: 'stub@payid.kolaleaf.dev', payIdReference: 'STUB-' + reference }`. Zero side effects, no sleeps.
  - `getPaymentStatus(ref)` → `{ status: 'completed', amount: 0, receivedAt: new Date() }`. Matches interface.
- `createMonoovaClient()` gains branches:
  1. If `isStubProvidersEnabled()` → `assertStubProvidersSafe()` then return `new StubMonoovaClient()`.
  2. Else: existing `validateMonoovaConfig()` path, but when `isMock && NODE_ENV !== 'production'` return `new StubMonoovaClient()` (convenience default). Production still throws.

**Execution note:** Test-first on both files (flag helper + stub client).

**Patterns to follow:** `src/lib/kyc/flag.ts` shape; `MonoovaClient` contract asserted by `payid-service.test.ts` mocks.

**Test scenarios (flag helper):**
- Happy path: flag unset → `isStubProvidersEnabled()===false`.
- Happy path: `KOLA_USE_STUB_PROVIDERS=true` + `NODE_ENV=development` → `true`; `assertStubProvidersSafe()` returns normally.
- Error path: flag `'true'` + `NODE_ENV=production` → `assertStubProvidersSafe()` throws naming the flag.
- Edge case: flag `'TRUE'`, `'1'`, or `'yes'` → returns `false` (strict `'true'` only).

**Test scenarios (stub client + factory):**
- Happy path: stub `createPayId` returns a ref prefixed with `STUB-`.
- Happy path: stub `getPaymentStatus` returns `status: 'completed'`.
- Integration: `createMonoovaClient()` with flag + dev → returns `StubMonoovaClient`.
- Error path: flag + prod → factory throws via `assertStubProvidersSafe`.
- Edge case: no flag, no keys, dev → returns `StubMonoovaClient` (convenience).
- Edge case: no flag, no keys, prod → throws existing missing-config error.

**Verification:** `generatePayIdForTransfer` driven by `StubMonoovaClient` transitions a fixture transfer to `AWAITING_AUD` with a `STUB-` ref.

---

- [ ] **Unit 3: In-adapter stubs for BudPay + Flutterwave `initiatePayout` / `getPayoutStatus`**

**Goal:** Teach the two payout providers to return deterministic fake payout results when secret keys are absent or `KOLA_USE_STUB_PROVIDERS=true`, mirroring the existing `listBanks`/`resolveAccount` stub pattern.

**Requirements:** R1, R4.

**Dependencies:** Unit 0 (BudPayProvider exists), Unit 2 (flag helper exists).

**Files:**
- Modify: `src/lib/payments/payout/budpay.ts`
- Modify: `src/lib/payments/payout/flutterwave.ts`
- Modify: `src/lib/payments/payout/__tests__/budpay.test.ts`
- Modify: `src/lib/payments/payout/__tests__/flutterwave.test.ts`

**Approach:**
- Private `inStubMode()` helper on each: `!this.config.secretKey || isStubProvidersEnabled()`.
- `initiatePayout` when stub: return `{ providerRef: 'STUB-BP-' + params.reference, status: 'success' }` (BudPay) / `'STUB-FW-'` (Flutterwave). Log one-shot dev notice per process, no network.
- `getPayoutStatus` when stub: return `{ status: 'success' }` (BudPay shape) / `{ status: 'SUCCESSFUL' }` (Flutterwave shape).
- Real-path behavior untouched.

**Execution note:** Test-first.

**Patterns to follow:** `FlutterwaveProvider.listBanks` — early check + log-once + deterministic return.

**Test scenarios:**
- Happy path: `new BudPayProvider({secretKey:'', apiUrl:'...'}).initiatePayout(...)` returns `{ providerRef: 'STUB-BP-...', status: 'success' }` with no `fetch` mock.
- Happy path: same for Flutterwave (`STUB-FW-`).
- Happy path: stub `getPayoutStatus` on each returns the success variant.
- Edge case: flag on with keys present → still uses stub path.
- Integration: `PayoutOrchestrator.initiatePayout(id)` transitions `AUD_RECEIVED → PROCESSING_NGN` against stubbed BudPay without network.
- Regression: keys present + flag off → real-path `initiatePayout` fires `fetch` (proves stub opt-in only).

**Verification:** Orchestrator tests green in both stub and real paths.

---

- [ ] **Unit 4: Wire payout kickoff after `handlePaymentReceived`**

**Goal:** Close the `AUD_RECEIVED → PROCESSING_NGN → ... → COMPLETED` loop by calling the orchestrator from the payment-received path, with a stub-mode success synthesizer so dev runs reach `COMPLETED`.

**Requirements:** R1, R2, R3, R7.

**Dependencies:** Unit 3 (for stub-mode flow to work without keys).

**Files:**
- Modify: `src/lib/payments/monoova/payid-service.ts` (`handlePaymentReceived`)
- Modify: `src/lib/payments/monoova/__tests__/payid-service.test.ts`
- Test: `src/lib/payments/payout/__tests__/payment-received-to-completed.test.ts` (new integration test)

**Approach:**
- After the existing `transitionTransfer(..., AUD_RECEIVED)`:
  1. `getOrchestrator().initiatePayout(transferId)`.
  2. Errors caught and logged via `log('error', ...)`; transfer left in `AUD_RECEIVED` for reconciliation. Pattern matches compliance side-effects in `createTransfer`.
  3. If `isStubProvidersEnabled()` → call `orchestrator.handlePayoutSuccess(transferId)` so dev runs cascade to `COMPLETED`.

**Execution note:** Test-first. Write the integration test asserting `CREATED → COMPLETED` in stub mode before modifying `handlePaymentReceived`.

**Patterns to follow:**
- Fire-and-forget compliance hooks in `src/lib/transfers/create.ts`.
- Orchestrator call shape in `handleFlutterwaveWebhook`.

**Test scenarios:**
- Happy path (real path mocked): amount matches → transfer reaches `PROCESSING_NGN`, orchestrator called once, `handlePayoutSuccess` NOT called.
- Happy path (stub mode): flag on + amount matches → transfer reaches `COMPLETED` via auto-synthesized success.
- Error path: `orchestrator.initiatePayout` throws → transfer stays in `AUD_RECEIVED`, error logged, `handlePaymentReceived` still resolves.
- Edge case: amount mismatch → existing `'Amount mismatch'` error, no orchestrator call.
- Integration (stub): full `CREATED → COMPLETED` via `generatePayIdForTransfer (stub Monoova)` → `handlePaymentReceived` → `orchestrator.initiatePayout (stub BudPay)` → `handlePayoutSuccess` → COMPLETED. Assert 7-event chain: `NULL_STATE→CREATED`, `CREATED→AWAITING_AUD`, `AWAITING_AUD→AUD_RECEIVED`, `AUD_RECEIVED→PROCESSING_NGN`, `PROCESSING_NGN→NGN_SENT`, `NGN_SENT→COMPLETED`.

**Verification:** Existing webhook/idempotency tests green. New integration produces the 7-event chain with zero `fetch` calls. `payoutProvider='BUDPAY'` on the final transfer row.

---

- [ ] **Unit 5: `POST /api/v1/transfers/:id/issue-payid`**

**Goal:** Owner-gated user trigger for `CREATED → AWAITING_AUD`.

**Requirements:** R6.

**Dependencies:** Units 1 and 2 (factory resolves in all modes).

**Files:**
- Create: `src/app/api/v1/transfers/[id]/issue-payid/route.ts`
- Create: `src/app/api/v1/transfers/[id]/issue-payid/_schemas.ts`
- Test: `src/app/api/v1/transfers/[id]/issue-payid/__tests__/route.test.ts`

**Approach:**
- `POST` handler, no body. `requireAuth` then `requireEmailVerified`.
- Load transfer; if `transfer.userId !== authedUserId` → 403.
- `generatePayIdForTransfer(transferId, createMonoovaClient())`.
- Error mapping:
  - `TransferNotFoundError` → 404
  - `KycNotVerifiedError` → 403
  - transfer-not-in-CREATED-state → 409
  - other → 500
- Response: `{ transfer }` with status 200.

**Execution note:** Test-first.

**Patterns to follow:**
- `src/app/api/v1/admin/transfers/[id]/retry/route.ts` for route shape.
- `src/app/api/v1/transfers/route.ts` for auth + error mapping.
- `src/app/api/v1/admin/transfers/[id]/_schemas.ts` for OpenAPI registration.

**Test scenarios:**
- Happy path: authed owner + transfer in `CREATED` + stub mode → 200 with `STUB-` PayID ref; transfer now `AWAITING_AUD`.
- Error path: unauthenticated → 401, factory never called.
- Error path: authed non-owner → 403, factory never called.
- Error path: `requireEmailVerified` fails → 403.
- Error path: transfer does not exist → 404.
- Error path: transfer in `AWAITING_AUD` already → 409.
- Error path: KYC not verified + `KOLA_DISABLE_KYC_GATE` unset → 403 with `KycNotVerifiedError` message.
- Integration: freshly registered user (unverified email) → 403.

**Verification:** Next.js build succeeds; curl smoke test returns 200 on happy path.

---

- [ ] **Unit 6: `POST /api/v1/admin/transfers/:id/simulate-payment`**

**Goal:** Admin/dev-gated trigger for `AWAITING_AUD → AUD_RECEIVED` that, with Unit 4, cascades to `COMPLETED` in stub mode.

**Requirements:** R7.

**Dependencies:** Unit 4.

**Files:**
- Create: `src/app/api/v1/admin/transfers/[id]/simulate-payment/route.ts`
- Create: `src/app/api/v1/admin/transfers/[id]/simulate-payment/_schemas.ts`
- Test: `src/app/api/v1/admin/transfers/[id]/simulate-payment/__tests__/route.test.ts`

**Approach:**
- Guard order:
  1. `requireAdmin(request)` → 401/403 on fail.
  2. `if (NODE_ENV === 'production' && !isStubProvidersEnabled()) return 404` — hide in prod unless flag is explicitly on.
- Optional body `{ amount?: string }`. Default = `transfer.sendAmount`.
- `handlePaymentReceived(transferId, new Decimal(amount))`.
- `logAuthEvent({ userId: adminId, event: 'ADMIN_SIMULATE_PAYMENT', metadata: { transferId, amount } })`.
- Error mapping mirrors Unit 5.

**Execution note:** Test-first.

**Patterns to follow:** `src/app/api/v1/admin/transfers/[id]/retry/route.ts`.

**Test scenarios:**
- Happy path (stub, admin): transfer in `AWAITING_AUD` → cascades to `COMPLETED`; response returns the completed transfer.
- Error path: non-admin → 403.
- Error path: `NODE_ENV=production` + flag off → 404.
- Error path: transfer not in `AWAITING_AUD` → 409.
- Error path: amount mismatch outside tolerance → 400 (existing `'Amount mismatch'` string).
- Edge case: body omits amount → uses `transfer.sendAmount`.
- Integration: audit log row written with `event=ADMIN_SIMULATE_PAYMENT`.

**Verification:** Full curl flow: register → create transfer → issue-payid → simulate-payment → GET transfer == `COMPLETED` with 7-event `TransferEvent` chain and `payoutProvider='BUDPAY'`.

## System-Wide Impact

- **Interaction graph:** `handlePaymentReceived` gains a downstream caller chain. Compliance hooks (velocity, AUSTRAC, security anomaly) run inside `createTransfer` — upstream of this plan's edits. `TransferEvent` rows authored by `transitionTransfer`, never bypassed.
- **Error propagation:** Orchestrator failures in Unit 4 are swallowed-and-logged so the webhook worker acks. Mirrors compliance-side-effect pattern. Reconciliation cron (`/api/cron/provider-reconciliation`) is the safety net.
- **State lifecycle risks:** None new. Stub refs prefixed (`STUB-`) for traceability and reconciliation filtering.
- **API surface parity:** New routes register OpenAPI schemas like existing admin routes. Stub mode does not add new response shapes.
- **Integration coverage:** Unit 4's integration test asserts the full 7-event chain — strongest proof no transition was skipped.
- **Unchanged invariants:**
  - `MonoovaClient` interface contract.
  - `PayoutProvider` interface contract (concrete providers swap; interface stable).
  - Webhook signature verification + `WebhookEvent` idempotency shape.
  - `transitionTransfer` state-machine guard rails.
  - `KOLA_DISABLE_KYC_GATE` semantics (already shipped).
  - `.env.example` gains `BUDPAY_SECRET_KEY`, `BUDPAY_API_URL`, `BUDPAY_WEBHOOK_SECRET`, `KOLA_USE_STUB_PROVIDERS=false`; loses all `PAYSTACK_*` vars.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Stub mode accidentally enabled in production | `assertStubProvidersSafe()` throws at factory construction; review `.env.example` and Railway env in PR |
| Orchestrator kickoff turns a fast webhook into a slow one | Catch-and-log in Unit 4; orchestrator uses `withRetry` internally; webhook ack does not depend on orchestrator success |
| MonoovaHttpClient Basic-auth swap breaks a consumer | Consumers use `MonoovaClient` interface only; header change is internal to `MonoovaHttpClient` |
| Stub-mode auto-success skips `PROCESSING_NGN → NGN_SENT` gate that webhooks normally drive | Explicit, tested, documented; `STUB-` prefix makes stub-mode transfers greppable if they ever leak to prod |
| Admin simulate route exposed in prod via misconfiguration | Dual-guard: `requireAdmin` AND `NODE_ENV + flag`. Returns 404, not 403 |
| Prisma enum rename breaks existing dev DBs | Migration file is reversible; dev envs can be reset. Pre-prod means no real-user impact |
| BudPay webhook payload shape differs from assumption | Implementer verifies against live docs at implementation time; Paystack webhook shape is the safe analog for skeleton |
| Orchestrator retry math breaks in reversed primary/fallback orientation | Unit 0's orchestrator test rewrite covers the exhaustion + failover branches explicitly |

## Documentation / Operational Notes

- `handoff/BUILD-LOG.md` entry on merge: new flag, two new routes, Paystack→BudPay swap.
- `.env.example` updates: drop `PAYSTACK_SECRET_KEY`, `PAYSTACK_API_URL`, `PAYSTACK_WEBHOOK_SECRET`; add `BUDPAY_SECRET_KEY`, `BUDPAY_API_URL`, `BUDPAY_WEBHOOK_SECRET`, `KOLA_USE_STUB_PROVIDERS=false`.
- Railway env deployment note: remove Paystack vars from staging/prod; do not set `KOLA_USE_STUB_PROVIDERS` in prod.
- No data migration required — enum rename is in-place DDL.

## Sources & References

- Related code:
  - `src/lib/payments/monoova/payid-service.ts`
  - `src/lib/payments/monoova/client.ts`
  - `src/lib/payments/payout/orchestrator.ts`
  - `src/lib/payments/payout/flutterwave.ts`
  - `src/lib/payments/payout/paystack.ts` (to be deleted)
  - `src/app/api/v1/admin/transfers/[id]/retry/route.ts`
  - `src/lib/kyc/flag.ts`
  - `prisma/schema.prisma`
- Recent commits:
  - `9aca155` — KYC gate move (precedent for per-concern flag helpers)
  - `57daf46` — In-process BullMQ worker boot (inline-vs-queued execution precedent)
- External docs:
  - Monoova JS SDK: https://github.com/sdks-io/monoova-js-sdk
  - BudPay developer docs: https://devs.budpay.com/
  - BudPay single payout: https://devs.budpay.com/single-payout
  - BudPay webhooks: https://devs.budpay.com/webhook
  - BudPay bank list: https://devs.budpay.com/bank-list
