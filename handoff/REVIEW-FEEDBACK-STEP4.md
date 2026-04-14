# Review Feedback — Step 4: Monoova PayID Integration
Date: 2026-04-14
Ready for Builder: YES

## Must Fix

None.

## Should Fix

1. **`src/lib/payments/monoova/payid-service.ts:42`** — `transitionTransfer` is called inside a `prisma.$transaction` callback, but `transitionTransfer` opens its own `prisma.$transaction` internally (state-machine.ts:23). The PayID data written via `tx.transfer.update` at line 33 and the state transition at line 42 run in separate transaction scopes. If the state transition succeeds but the outer transaction rolls back (or vice versa), the transfer will have inconsistent state. **Recommendation:** Either pass the transaction client (`tx`) through to `transitionTransfer`, or move the `transitionTransfer` call outside the `$transaction` block (after the PayID data is committed). Since `transitionTransfer` uses optimistic locking, calling it after the outer transaction commits is the simpler fix and still safe.

2. **`src/lib/payments/monoova/payid-service.ts:62`** — `handlePaymentReceived` reads the transfer outside a transaction, then calls `transitionTransfer` which reads it again inside its own transaction. Between the two reads, the transfer amount could theoretically change (admin correction, concurrent update). The window is small but exists. **Recommendation:** Log to BUILD-LOG as a known gap. Low risk for now since amount changes after AWAITING_AUD are not a current flow.

3. **`src/lib/payments/monoova/webhook.ts:22`** — The payload is re-serialized with `JSON.stringify(payload)` before signature verification. If the incoming payload was parsed from JSON, key ordering may differ from what the sender signed. This is correct only if the API route passes the raw body string for signing. When the API route is built in Step 9, the raw body must be used for signature verification, not the re-serialized object. **Recommendation:** Add a comment at line 22 noting this dependency, so Step 9 does not introduce a subtle signature mismatch bug.

## Escalate to Architect

None.

## Cleared

Webhook signature verification uses HMAC-SHA256 with `crypto.timingSafeEqual` — correct and timing-safe. Webhook idempotency via `WebhookEvent` unique constraint works correctly; duplicates are silently skipped. Amount tolerance check uses `Decimal.js` with $0.01 threshold — no floating point issues. PayID is only generated from CREATED state (guarded at line 18). State transitions use the existing state machine with optimistic locking. `MonoovaClient` is interface-based and injected as a parameter — clean for testing. All 27 tests pass with mocked dependencies, no real API calls. The 5 test files cover the stated scenarios including edge cases (unicode payloads, tampered signatures, unknown references, amount mismatches).
