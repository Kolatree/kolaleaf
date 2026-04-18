# Wave 1 audit — KYC / identity verification

## Route inventory

- `POST /api/v1/kyc/initiate` — Mints a Sumsub applicant + SDK access token. Blocks if user is already VERIFIED or IN_REVIEW (409). Transitions kycStatus PENDING → IN_REVIEW. Logs `kyc.initiated`.
- `GET /api/v1/kyc/status` — Returns current `kycStatus` + `applicantId` for the authenticated user.
- `POST /api/webhooks/sumsub` — Verifies HMAC-SHA256 signature, then dispatches raw payload to the webhook dispatcher (in-process during dev/test, BullMQ in production). Acknowledges immediately; processing is async in prod.

## Webhook event coverage

| Event | Handled? | kycStatus transition | Audit log | Test |
|---|---|---|---|---|
| `applicantReviewed` / GREEN | Yes | → VERIFIED | `kyc.approved` via `logAuthEvent` | Unit + E2E |
| `applicantReviewed` / RED | Yes | → REJECTED (reasons stored) | `kyc.rejected` via `logAuthEvent` | Unit + E2E |
| `applicantReviewed` / other answer | No | No transition; silently no-ops | None | None |
| `applicantPending` | No | Not handled | None | None |
| `applicantCreated` | No | Not handled | None | None |
| Any other type | No | Not handled; no-ops silently | None | None |

Unhandled events are still written to `webhookEvent` table (as the idempotency claim row) and marked processed. This means the row survives for audit but the kycStatus does not move and no error is logged — unrecognised event types are silent.

## Gate enforcement

- **Transfer creation:** VERIFIED required at `src/lib/transfers/create.ts:27` — inside a Prisma transaction, throws `KycNotVerifiedError` before any write. Covered by E2E test.
- **PayID generation:** `src/lib/payments/monoova/payid-service.ts:generatePayIdForTransfer` — does NOT check kycStatus. It validates only that the transfer exists and is in `CREATED` state. The implicit protection is that `createTransfer` already required VERIFIED, so any transfer in CREATED state was created by a verified user. However, if an admin or direct-DB operation created a transfer row for an unverified user, PayID generation would proceed.
- **`requireKyc` middleware** exists in `src/lib/auth/middleware.ts:29` but is not called by either `/transfers` or `/payid` routes (no route under `src/app/api/v1/` imports it based on search). It is defined but unused in the route layer.

## Rejection + re-initiate

- `retryKyc` function exists at `src/lib/kyc/sumsub/kyc-service.ts:111`. It: validates `kycStatus === REJECTED`, gets a fresh Sumsub access token on the existing `kycProviderId`, resets status to `IN_REVIEW`, clears `kycRejectionReasons`, logs `kyc.retry`.
- **Gap:** No HTTP route exposes `retryKyc`. A REJECTED user has no API endpoint to call. The function is tested in unit and E2E but is unreachable from any client. This is a P0 gap — rejected users are permanently blocked with no in-app path forward.

## Session token flow

- Mint: `src/app/api/v1/kyc/initiate/route.ts` calls `initiateKyc`, which calls `client.getAccessToken(applicantId)` — token life is controlled by Sumsub (typically 10 minutes).
- **Rate limiting:** None. A user can POST `/kyc/initiate` repeatedly. `initiateKyc` guards against VERIFIED and IN_REVIEW re-entry (throws 409), but a user stuck in PENDING can hammer the endpoint, creating a new Sumsub applicant each time — there is no cooldown or max-attempt check.
- **Session expiry:** Sumsub-side only. The route returns `verificationUrl` and the SDK token; the app does not cache or track token expiry locally.

## Gaps prioritized

**P0**
1. `retryKyc` is unrouted — REJECTED users cannot re-initiate KYC from the API. They are permanently blocked.

**P1**
2. `applicantReviewed` with a reviewAnswer that is neither GREEN nor RED silently no-ops with no kycStatus change and no log. Sumsub can return `YELLOW` (requires additional checks) — this case is unhandled.
3. Other Sumsub event types (`applicantPending`, `applicantCreated`, `applicantActionReviewed`) are silently ignored. No logging, no handling. Sumsub sends `applicantPending` during manual review periods; ignoring it means no observability into that stage.

**P2**
4. No rate limit on `POST /kyc/initiate` — a PENDING user can spam it, creating multiple Sumsub applicants.
5. `generatePayIdForTransfer` has no direct kycStatus guard; relies on the upstream transfer-creation gate being the only entry point. An admin bypass or direct insert bypasses the check.
6. `requireKyc` middleware is dead code at the route layer — defined but not wired into any route handler.
