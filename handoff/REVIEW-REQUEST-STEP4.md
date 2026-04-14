# Review Request — Step 4: Monoova PayID Integration

**Ready for Review: YES**

## Summary

Built the Monoova PayID integration for AUD collection. Service layer only — no API routes (those come in Step 9). Full TDD: 27 new tests written first, all passing. Zero regressions (137/137 total suite).

## Files Changed

### Source (4 files)

| File | Lines | What |
|------|-------|------|
| `src/lib/payments/monoova/verify-signature.ts` | 1-22 | HMAC-SHA256 signature verification with constant-time comparison via `crypto.timingSafeEqual` |
| `src/lib/payments/monoova/client.ts` | 1-96 | `MonoovaClient` interface + `MonoovaHttpClient` implementation. Uses `fetch`. Factory function `createMonoovaClient()` reads env vars |
| `src/lib/payments/monoova/payid-service.ts` | 1-79 | `generatePayIdForTransfer` (CREATED -> AWAITING_AUD) and `handlePaymentReceived` (AWAITING_AUD -> AUD_RECEIVED with $0.01 tolerance) |
| `src/lib/payments/monoova/webhook.ts` | 1-80 | `handleMonoovaWebhook`: signature verify -> idempotency check -> transfer lookup -> process payment -> store WebhookEvent |

### Barrel Exports (2 files)

| File | What |
|------|------|
| `src/lib/payments/monoova/index.ts` | Exports all types and functions from monoova module |
| `src/lib/payments/index.ts` | Re-exports monoova module |

### Tests (4 files, 27 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `__tests__/verify-signature.test.ts` | 5 | Valid sig, tampered payload, empty sig, wrong secret, unicode |
| `__tests__/client.test.ts` | 7 | Create PayID success, API error, network timeout, invalid response, get status, no receivedAt, status error |
| `__tests__/payid-service.test.ts` | 10 | Generate PayID + transition, reject non-CREATED, reject missing transfer, client error propagation, exact amount, tolerance underpay/overpay, reject underpay/overpay beyond tolerance, transfer not found |
| `__tests__/webhook.test.ts` | 5 | Full end-to-end, idempotency skip, invalid signature rejected, unknown reference logged, amount mismatch flagged |

## Key Decisions

1. **`MonoovaClient` is an interface** — `MonoovaHttpClient` implements it, but any code accepting `MonoovaClient` can use a mock/stub. `generatePayIdForTransfer` takes the client as a parameter for easy testing.

2. **PayID reference format**: `KL-{transferId}-{timestamp}` — prefixed for bank statement identification as specified.

3. **Timing-safe signature comparison** — `crypto.timingSafeEqual` prevents timing attacks on webhook signature verification.

4. **Amount tolerance**: $0.01 AUD using `Decimal.js` for precise comparison — no floating point issues.

5. **Webhook idempotency**: Uses `WebhookEvent` table's `@@unique([provider, eventId])` constraint. Unknown transfer references are stored as unprocessed (for audit) but don't throw.

6. **State transitions** reuse the existing `transitionTransfer` from Step 3 — no duplication of optimistic locking or audit event logic.

## Open Questions

None. Brief was clear and unambiguous.
