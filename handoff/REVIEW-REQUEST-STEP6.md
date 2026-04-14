# Review Request — Step 6: Sumsub KYC Integration

**Ready for Review: YES**

## Summary

Full Sumsub KYC service layer: client with HMAC-SHA256 request signing, KYC lifecycle management (initiate/approve/reject/retry), webhook handler with idempotency and signature verification, and timing-safe signature comparison. All TDD — tests written first, watched fail, then implemented.

## Files Changed

### New files (src/lib/kyc/sumsub/)

| File | Lines | Purpose |
|------|-------|---------|
| `client.ts` | 1-119 | SumsubClient interface + SumsubHttpClient with HMAC-SHA256 request signing. Methods: createApplicant, getAccessToken, getApplicantStatus |
| `kyc-service.ts` | 1-126 | KYC lifecycle: initiateKyc (creates applicant, transitions to IN_REVIEW), handleKycApproved, handleKycRejected (stores reasons), getKycStatus, retryKyc (from REJECTED) |
| `webhook.ts` | 1-91 | Sumsub webhook handler: signature verification, idempotency via WebhookEvent, routes applicantReviewed events to approve/reject handlers |
| `verify-signature.ts` | 1-22 | HMAC-SHA256 signature verification with crypto.timingSafeEqual |
| `index.ts` | 1-5 | Barrel export |

### Test files (src/lib/kyc/sumsub/__tests__/)

| File | Tests | Coverage |
|------|-------|----------|
| `client.test.ts` | 12 | createApplicant (success, API error, invalid response, network failure), getAccessToken (success, error, invalid response), getApplicantStatus (approved, rejected, pending, error), HMAC headers |
| `kyc-service.test.ts` | 10 | initiateKyc (happy path, already verified guard, already in review guard), handleKycApproved, handleKycRejected with reasons, getKycStatus (with/without applicantId), retryKyc (happy path, not rejected guard, no applicantId guard) |
| `webhook.test.ts` | 5 | Approved webhook, rejected webhook, idempotency skip, invalid signature, unknown applicant logged |
| `verify-signature.test.ts` | 5 | Valid signature, tampered payload, empty signature, wrong secret, unicode |
| **Total** | **32** | |

### Schema migration

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `kycRejectionReasons String[] @default([])` to User model |
| `prisma/migrations/20260414074524_add_kyc_rejection_reasons/` | Migration SQL |

## Key Design Decisions

1. **SumsubClient interface** — Same pattern as MonoovaClient. Interface for testability, concrete SumsubHttpClient for production. Factory function `createSumsubClient()` reads env vars.

2. **HMAC-SHA256 request signing** — Sumsub API requires signing each request with `ts + method + path + body`. Signature goes in `X-App-Access-Sig` header, timestamp in `X-App-Access-Ts`.

3. **Webhook event ID** — Sumsub doesn't send a unique event ID. We compose one from `applicantId:eventType` to ensure idempotency per applicant per event type.

4. **KYC status guards** — initiateKyc throws if already VERIFIED or IN_REVIEW. retryKyc only works from REJECTED. These prevent invalid state transitions.

5. **Auth event logging** — All KYC transitions (initiated, approved, rejected, retry) logged via `logAuthEvent` from Step 2, per AUSTRAC audit requirements.

6. **Timing-safe comparison** — All signature verification uses `crypto.timingSafeEqual` per Richard's standing requirement.

## Open Questions

None.

## How to Verify

```bash
# Run all KYC tests (32 tests)
npm test -- src/lib/kyc/sumsub/

# Run full suite (236 tests, 30 files, 0 failures)
npm test
```
