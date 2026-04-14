# Review Feedback -- Step 6: Sumsub KYC Integration
Date: 2026-04-14
Ready for Builder: NO

## Must Fix

1. **webhook.ts:29** -- Idempotency key `applicantId:eventType` allows only one event per type per applicant, ever. If Sumsub sends a second `applicantReviewed` after a retry (user rejected, retries, gets approved), the webhook will silently skip it because the first `applicantReviewed` already exists in WebhookEvent. The idempotency key must include something that distinguishes separate review cycles. Options: (a) include a timestamp or sequence from the payload if Sumsub provides one, (b) use `applicantId:eventType:reviewAnswer` so GREEN and RED are separate keys, (c) delete the old WebhookEvent record when `retryKyc` clears rejection reasons. Option (b) is simplest and handles the reject-then-approve flow. Option (c) is cleanest but adds coupling.

2. **kyc-service.ts:36** -- `createSumsubClient()` is called inside `initiateKyc` and `retryKyc`, reading env vars on every invocation. This is not a correctness bug, but it means the functions cannot be tested with a custom client without mocking the factory. The `client.test.ts` tests use `SumsubHttpClient` directly and `kyc-service.test.ts` mocks `createSumsubClient`, which works. However, the pattern in this codebase (MonoovaClient, FxRateProvider) is constructor injection. `initiateKyc` and `retryKyc` should accept an optional `SumsubClient` parameter or the service should be a class with an injected client, consistent with Step 7's `RateService` pattern. This is a standards/consistency issue that affects testability and must be aligned before more code depends on it.

## Should Fix

1. **webhook.ts:60-67** -- Non-`applicantReviewed` event types (e.g. `applicantPending`, `applicantCreated`) are silently stored as processed without being routed. This is fine for now, but the `processed: true` flag on line 70 is misleading for events that were not actually handled -- they were stored but no business logic ran. Consider setting `processed: false` for unrecognized event types, or adding a comment documenting which types are intentionally ignored.

2. **kyc-service.ts:70-82** -- `handleKycApproved` does not guard against being called when the user is already VERIFIED. If a duplicate webhook somehow bypasses idempotency (race condition, manual call), it will update the user again and log a duplicate `kyc.approved` audit event. A guard `if (user.kycStatus === 'VERIFIED') return` would be defensive. Same applies to `handleKycRejected` (line 84) -- no guard against double-rejection.

3. **client.ts:78** -- `levelName` is passed as a query parameter in the URL path for `createApplicant` and `getAccessToken`. The value comes from an env var. If `SUMSUB_LEVEL_NAME` contains special characters (spaces, ampersands), the URL will break. Use `encodeURIComponent(this.levelName)` in the path construction.

4. **verify-signature.ts:17-18** -- `Buffer.from(signature, 'hex')` will silently produce a truncated buffer if `signature` contains non-hex characters (e.g. a `0x` prefix or base64 by mistake). The `catch` on line 20 handles the length mismatch from `timingSafeEqual`, but the silent truncation could mask a misconfiguration. Consider validating that `signature` matches `/^[0-9a-f]+$/i` before comparing.

## Escalate to Architect

None.

## Cleared

- `verify-signature.ts` -- HMAC-SHA256 with `crypto.timingSafeEqual`, correct buffer encoding, catch block for length mismatch. Solid.
- `client.ts` -- HMAC request signing follows Sumsub's documented `ts + method + path + body` format. Interface-based design. Response validation on all three endpoints.
- `kyc-service.ts` -- State guards on `initiateKyc` (VERIFIED, IN_REVIEW) and `retryKyc` (not REJECTED, no applicantId). Auth audit events logged for all transitions. Rejection reasons stored and cleared on retry.
- `webhook.ts` -- Signature verification before any processing. Unknown-applicant case handled gracefully (stored as unprocessed). Error path stores event as unprocessed then re-throws.
- Schema migration -- `kycRejectionReasons String[] @default([])` is correct, additive, non-destructive.
- Test coverage -- 32 tests across 4 files. All edge cases covered. Tests pass (236/236 suite-wide).
