# Review Feedback — Step 15a
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `handoff/REVIEW-REQUEST.md:94` — Verification Run claims `npx tsc --noEmit → 0 errors`. It does not: 7 errors remain (4 × TS2554 in `src/lib/kyc/sumsub/__tests__/kyc-service.test.ts` at L94/105/226/238 for `logAuthEvent` 1-arg vs 2-arg; 2 × TS2352 at `tests/lib/transfers/queries.test.ts:125-126` for the `Record<string, unknown>` casts; 1 × TS2307 in framework-generated `.next/types/validator.ts`). These are the same 7 errors the Phase B triage scopes into item #7 (third wave, a later 15-wave), so it is correct that they are not fixed here — but the claim in REVIEW-REQUEST is factually wrong and should read "0 new tsc errors vs baseline; 7 carry-forward errors tracked by Phase B item #7." Document, do not fix in 15a.

## Escalate to Architect
None.

## Verified Working

**Webhook signature verification — raw body.**
Verified for all four providers that `rawBody = await request.text()` is captured once at the route layer and passed unchanged to the handler. No re-serialization. Signed string is the exact string that came in over HTTP.
- Monoova (`route.ts:9,16` → `webhook.ts:33`): HMAC-SHA256 over `rawBody`, constant-time compare via `timingSafeEqual`.
- Sumsub (`route.ts:9,16` → `webhook.ts:32`): HMAC-SHA256 over `rawBody`, same pattern.
- Paystack (`route.ts:14,21` → `webhooks.ts:127-136`): HMAC-SHA512 over `rawBody`, hex-buffer compare with explicit length check before `timingSafeEqual`.
- Flutterwave (`route.ts:14,21` → `webhooks.ts:40-44`): static-secret compare (per provider docs; not HMAC), utf-8 buffer length check then `timingSafeEqual`.
- `JSON.parse(rawBody)` only runs post-verification. Route layer pre-parses to 400 on invalid JSON before invoking the handler — this doesn't change the bytes the handler signs.

**Idempotency atomic-create.**
All four handlers implement `try { webhookEvent.create } catch (P2002) { return }` with NO state transition before the create succeeds. Old read-then-write pattern fully gone. On processing failure the claim row is deleted (monoova:85-87, sumsub:87-89, flutterwave:90-92, paystack:179-181) so the provider's next retry can re-enter cleanly — no permanent lockout on a single failed delivery. `processed: true` is only set on successful processing. The "unknown reference/applicant" branches correctly set `processed: true` to park the audit row without triggering retry.

**Cron auth.**
`src/lib/auth/cron-auth.ts:14-17` uses `timingSafeEqual` correctly — explicit length check first (prevents the throw on mismatched-length buffers), then constant-time compare. Bearer-prefix handling tolerant of missing header. Returns false on missing `CRON_SECRET` env. Helper is invoked from all four cron routes (`float:6`, `rates:6`, `reconciliation:6`, `staleness:6`).

**Login error leak.**
`src/app/api/auth/login/route.ts:39-45`: `console.error('[auth/login]', error)` then generic `{ error: 'Login failed' }, status: 401`. No `error.message` reaches the response body.

**Admin P2025 → 404.**
`src/app/api/admin/transfers/[id]/route.ts:30-34`: narrow catch on `Prisma.PrismaClientKnownRequestError && code === 'P2025'` returning `{ error: 'not_found' }`. AuthError handled separately first. Other errors fall through to logged-500 — schema info does not leak. Body shape (`{ error: 'not_found' }`) carries no model or constraint names.

**Test infrastructure.**
`src/lib/referrals/__tests__/referral-service.test.ts:61-74`: `cleanup()` no longer deletes `corridor` or `rate` rows, with inline comment explaining the dependency on seeded data. `createTransferForUser` uses findUnique-or-create so this file is self-contained. Confirmed standalone run passes (10/10). `tests/lib/transfers/queries.test.ts:30-36`: `afterEach` wipes only transfers/events, preserving the beforeAll user/recipient fixtures. Confirmed standalone run passes (9/9). Full suite: 387/387. No test-order dependence introduced.

**Untouched-code claim.**
`git diff --stat HEAD` plus the three untracked files (`src/lib/auth/cron-auth.ts`, and the two Step-14 carry-forward files already reviewed) exactly matches the file list in REVIEW-REQUEST. No scope drift.

## Cleared
Step 15a (webhook + auth security). Four of the ten Phase B FIX-NOW items — #1 raw-body signature, #2 atomic-create idempotency, #4 admin P2025→404, #10 cron `timingSafeEqual` + login error-leak — are all correct and consistent across the four webhook surfaces and two auth surfaces. Full test suite green (387/387), first time in this codebase. Step 15a is clear.
