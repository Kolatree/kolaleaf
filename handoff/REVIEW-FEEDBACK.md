# Review Feedback — Step 15e
Date: 2026-04-15
Ready for Builder: NO

## Must Fix

- `src/app/api/account/phone/add/route.ts:46-80` + `src/app/api/account/phone/verify/route.ts:82-98` — **Cross-user identifier hijack via abandoned unverified claim.** The `identifier` column is globally unique (`UserIdentifier.identifier String @unique`, schema.prisma:109), so there is only ever ONE row per phone. The `add` route's 409 guard only blocks when the existing row is `verified=true` (route.ts:49), which is correct by the spec. But the subsequent `upsert` uses `where: { identifier: phone }` with an empty `update` branch — so when User A has parked an unverified claim, User B's "add" call leaves the row pointing at **User A**, and only creates a `PhoneVerificationCode` under User B. When User B's `verify` call runs `prisma.userIdentifier.update where: { identifier: phone }`, it flips `verified=true` on the row that still belongs to User A. Result: User A ends up with a verified phone they never verified, User B has no identifier row at all, and AuthEvent PHONE_VERIFIED is written under User B while the state lives on A. This is both a correctness bug and a phone-hijack path (malicious A parks unverified claim, waits for legit B to verify, claim becomes verified on A's account). Fix: in the `add` upsert, when the existing row belongs to a different user and is unverified, either delete-and-recreate under the current user, or set `update: { userId, verified: false, verifiedAt: null }` so ownership transfers atomically before the code is issued. Add a regression test: user A creates unverified identifier → user B runs add+verify → asserting the final `UserIdentifier.userId === B`.

## Should Fix

- `tests/app/api/account/phone/verify.test.ts` — no test covers the abandoned-cross-user path above. Once the Must Fix is in, add a regression case. This is what prevented the bug from being caught.
- `src/lib/auth/two-factor-challenge.ts:65,78-81` — `verifyChallenge` guards on `attempts >= MAX_ATTEMPTS` but does not set `consumedAt` when the 5th attempt is exhausted via this helper (unlike the `verify` route which burns on attempt 5). Dead challenges linger with `consumedAt = null` until expiry. Not a security issue (the guards still refuse), but diverges from the route's pattern and from what an auditor would expect. 15f can harmonize this when wiring it up; flagging so it's not forgotten.

## Escalate to Architect

- None. AuthEvent.event is `String` (schema.prisma:236) so no migration is needed for the new event names; Bob's open question #2 is the Must Fix above; bcrypt cost 4 is acceptable per the brief and the inline rationale is sound.

## Cleared

- Untouched-code claim verified: `git diff HEAD -- src/lib/auth/login.ts src/app/api/auth/verify-2fa/route.ts` is empty. 15f work is deferred cleanly.
- Twilio client fail-fast in production on any missing env var (client.ts:23-33). Dev fallback returns `{ok:true, id:'dev-mode'}` and logs to stdout only when all three env vars absent.
- `sendSms` never throws — returns structured `{ok, id?, error?}` on every branch (send.ts:27-58).
- `normalizePhone` placeholder is clearly documented (phone.ts:15-27) and flagged for `libphonenumber-js` replacement. Regex `/^\+\d{7,15}$/` after stripping spaces/dashes/parens is a sound temporary bar.
- 6-digit SMS code generation via `crypto.randomInt(0, 1_000_000)` + `padStart(6, '0')` covers the full `000000`-`999999` space (phone.ts:49-54). bcrypt cost 4 at rest, raw code only in SMS body + dev stdout, never persisted.
- `add` rate limit correctly scoped to `{ userId, phone }` with 1h window (route.ts:54-63); 429 response includes `retryAfter`.
- `verify` increments attempts BEFORE bcrypt compare on all paths; 5th attempt burns `usedAt` regardless of correctness (route.ts:58-68). `$transaction` wraps identifier flip + code consume + AuthEvent atomically (route.ts:82-98).
- `remove` blocks with 400 when `twoFactorMethod === 'SMS'` (route.ts:38-43), 404 when identifier not on user, writes PHONE_REMOVED event on success.
- Arch's `validatePasswordComplexity` → `{ok:true, password}` narrowing: both call sites consume `pwCheck.password` (register/route.ts:36, reset-password/route.ts:32) with no `as string` cast. Pre-existing 15d tsc error gone; `npx tsc --noEmit` clean.
- Test suite: 481/481 green on local run.
