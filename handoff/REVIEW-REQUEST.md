# Review Request — Step 15a (Webhook + Auth Security)
*Bob did the substantive work; Arch wrote this handoff doc and fixed the test infrastructure.*

Ready for Review: YES

---

## What Was Built

Step 15a is the security-critical Wave 1 of Step 15: webhook signature verification corrected to use raw body, idempotency converted from read-then-write race to atomic create-as-lock, cron auth tightened to timing-safe, login route stops leaking raw error messages, admin transfer detail handles `P2025` cleanly. Plus test-infrastructure fixes so the suite is fully green for the first time in this codebase.

This is one wave of a multi-wave Step 15 (15b–15l still to come). 15a is committed-ready by itself; it's a meaningful security checkpoint.

---

## Files to Review

### Webhook signature verification — sign against raw body, not re-serialized payload

| File | Change |
|------|--------|
| `src/app/api/webhooks/monoova/route.ts` | Capture `rawBody` and pass through to handler. |
| `src/app/api/webhooks/sumsub/route.ts` | Same. |
| `src/app/api/webhooks/paystack/route.ts` | Same. |
| `src/app/api/webhooks/flutterwave/route.ts` | Same. |
| `src/lib/payments/monoova/webhook.ts` | `verifySignature(rawBody, signature)` — uses raw HTTP body for HMAC, not `JSON.stringify(payload)`. |
| `src/lib/kyc/sumsub/webhook.ts` | Same shape — Sumsub signs raw HTTP body per their docs. |
| `src/lib/payments/payout/webhooks.ts` | Same for Flutterwave + Paystack handlers. |
| `src/lib/payments/monoova/__tests__/webhook.test.ts` | Updated fixtures: tests now provide a captured rawBody string and sign that, mirroring real provider behavior. |
| `src/lib/kyc/sumsub/__tests__/webhook.test.ts` | Same. |
| `src/lib/payments/payout/__tests__/webhooks.test.ts` | Same. |
| `tests/app/api/webhooks/monoova.test.ts` | Same. |
| `tests/security/webhook-security.test.ts` | Same. |
| `tests/e2e/kyc-flow.test.ts` | Same. |
| `tests/e2e/transfer-lifecycle.test.ts` | Same. |

### Webhook idempotency — atomic create-as-lock

| File | Change |
|------|--------|
| `src/lib/payments/monoova/webhook.ts` | Replaced read-then-write idempotency with `try { create } catch (P2002) { return early }`. The unique constraint on `(provider, eventId)` is now the lock, not a post-hoc safety net. Also fixes the silent-skip-on-failed-row variant by only marking `processed: true` on successful processing. |
| `src/lib/kyc/sumsub/webhook.ts` | Same pattern. |
| `src/lib/payments/payout/webhooks.ts` | Same pattern for Flutterwave and Paystack. |

### Cron auth tightening

| File | Change |
|------|--------|
| `src/lib/auth/cron-auth.ts` | NEW. Centralizes `requireCronAuth(request)` using `crypto.timingSafeEqual` for bearer comparison. |
| `src/app/api/cron/float/route.ts` | Use the new helper. |
| `src/app/api/cron/rates/route.ts` | Same. |
| `src/app/api/cron/reconciliation/route.ts` | Same. |
| `src/app/api/cron/staleness/route.ts` | Same. |

### Login error-leak fix + admin P2025 → 404

| File | Change |
|------|--------|
| `src/app/api/auth/login/route.ts` | `console.error('[auth/login]', err)` for diagnostics; user-facing response is now generic `"Login failed"`. |
| `src/app/api/admin/transfers/[id]/route.ts` | Catches `PrismaClientKnownRequestError` with code `P2025` and returns `{ error: 'not_found' }, status: 404`. No Prisma error message leaks to the client. |

### Test infrastructure — make the suite truly green

| File | Change |
|------|--------|
| `src/lib/referrals/__tests__/referral-service.test.ts` | Cleanup no longer deletes corridors or rates (they're seeded data shared with other test files; this test reuses the seed via findUnique-or-create). Inline comment explains why. |
| `tests/lib/transfers/queries.test.ts` | `afterEach` scoped to wipe transfers/events only, preserving `beforeAll` user/recipient fixtures. Matches the pattern already used in `state-machine.test.ts`. |

### Step 14 carry-forward (already cleared by Richard, included for completeness in this branch)

| File | Notes |
|------|-------|
| `src/app/api/rates/public/route.ts` | New endpoint — 8/8 tests pass. |
| `tests/app/api/rates/public.test.ts` | New tests. |
| `src/app/(dashboard)/send/page.tsx` | URL swap. |
| `src/app/_components/landing-page.tsx` | URL swap + comment. |
| `src/lib/transfers/queries.ts` | `recipient` include + `TransferWithRecipient` type. |
| `tests/lib/transfers/queries.test.ts:106-123` | New recipient-enrichment test. |

---

## Decisions Made

- **Atomic create-as-lock** is the only correct idempotency pattern under concurrent webhook delivery. Read-then-write is a race regardless of how fast the writer is. This is now consistent across all four webhook handlers.
- **Raw body** is captured at the route layer (where Next.js gives us a Request with `text()` access) and passed by reference into the handler. Handlers no longer re-serialize before signing. Tests use a captured raw-body string and sign that — mirrors real provider behavior.
- **timingSafeEqual** for cron bearer matches the webhook layer's existing pattern. Surface is small but consistency matters.
- **Cleanup hygiene in tests** — the test suite was previously dependent on a fragile order. Now tests don't delete data they didn't create. AUD-NGN corridor/rate stay seeded across all files.

---

## Verification Run

```
npx tsc --noEmit             →  0 errors
npm test -- --run            →  387 passed / 0 failed   ← FULL GREEN, first time in this codebase
```

This is a step up from the prior baseline ("4 known flaky in queries.test.ts") — those were not actually flaky; they were a real bug in the test cleanup pattern, now fixed.

---

## Open Questions

None for this wave. The waves to come (15b–15l) will introduce real new behavior; this wave was about closing security gaps without changing user-visible APIs.

---

## Known Gaps (logged in BUILD-LOG, addressed in later 15-waves)

- `getTransfer` user-safe field projection — Wave 15b
- `RateService` bypass on public route — Wave 15b
- Observability (log every catch + worker start/end) — Wave 15b
- Admin dashboard error banner — Wave 15b
- Send-page rate-load error surface — Wave 15b
- Webhook queue/ack split (BullMQ + Redis) — Wave 15i
- Email verification + password reset (Resend) — Wave 15d
- SMS 2FA + phone verification (Twilio) — Wave 15e
- 2FA setup flow on /account — Wave 15f
- Account self-service (change email/password) — Wave 15g
- /activity/[id] transfer detail page — Wave 15h
- Provider env-var validation + retry/backoff — Wave 15j
- Public stub pages + mobile menu — Wave 15k
