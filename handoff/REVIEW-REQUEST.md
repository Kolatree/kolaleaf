# Review Request -- Step 15e

**Ready for Review:** YES
**Step:** 15e -- Twilio SMS integration + phone verification + SMS 2FA helpers
**Builder:** Bob
**Date:** 2026-04-15

---

## Scope

Ships:
- Twilio SDK wiring + dev/test `[sms-dev]` stdout fallback (mirrors 15d email shape).
- Phone-verification flow: `POST /api/account/phone/add` issues a 6-digit
  SMS code (10min expiry, 3/hr rate limit, cross-user verified-uniqueness gate);
  `POST /api/account/phone/verify` validates, attempts-capped at 5, atomic
  flip-identifier + consume-code + write AuthEvent on success.
- `POST /api/account/phone/remove` hard-deletes a PHONE identifier, blocked
  while `User.twoFactorMethod === 'SMS'`.
- `TwoFactorChallenge` helpers (`issueSmsChallenge`, `verifyChallenge`) for
  15f to plug into login.ts -- not wired to any route in this step.
- `AuthEvent` strings added: `PHONE_VERIFIED`, `PHONE_REMOVED` (plus the 2FA
  challenge events will be emitted from 15f's login route; the helpers
  deliberately do NOT write audit rows themselves so the caller controls
  the log context).

No schema migrations (15c covered all tables). One new dep: `twilio`.

Test count: 438 -> 481 (43 new, all green). tsc: 0 new errors; one pre-existing
error from 15d flagged in Known Gaps.

---

## Files Changed

### New

- `src/lib/sms/client.ts` -- Twilio init; fail-fast on missing SID/token/from in prod.
- `src/lib/sms/send.ts` -- `sendSms()` with dev `[sms-dev]` fallback. Never throws.
- `src/lib/sms/index.ts` -- barrel.
- `src/lib/auth/phone.ts` -- `normalizePhone` (regex placeholder, documented
  inline), `InvalidPhoneError`, `generateSmsCode` (bcrypt cost 4), `verifySmsCode`.
- `src/lib/auth/two-factor-challenge.ts` -- `issueSmsChallenge`, `verifyChallenge`.
  Expiry 5min; attempts-cap 5; increments on every submission.
- `src/app/api/account/phone/add/route.ts` -- requireAuth, normalise, 409 on
  cross-user verified match, 429 on 3-per-hour rate limit, upsert identifier,
  invalidate prior codes, store hash, dispatch SMS.
- `src/app/api/account/phone/verify/route.ts` -- requireAuth, 400 invalid_code,
  403 too_many_attempts on 5th submission (code burned), `$transaction`
  flips identifier+consumes code+writes PHONE_VERIFIED on success.
- `src/app/api/account/phone/remove/route.ts` -- requireAuth,
  400 cannot_remove_phone_while_2fa_active, 404 if identifier not on user,
  delete + PHONE_REMOVED AuthEvent on success.
- `tests/lib/sms/send.test.ts` -- 6 tests.
- `tests/lib/auth/phone.test.ts` -- 13 tests (normalise, code gen, round-trip).
- `tests/lib/auth/two-factor-challenge.test.ts` -- 7 tests.
- `tests/app/api/account/phone/add.test.ts` -- 6 tests.
- `tests/app/api/account/phone/verify.test.ts` -- 7 tests.
- `tests/app/api/account/phone/remove.test.ts` -- 5 tests.

### Modified

- `.env` -- added `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (blank).
- `.env.example` -- mirrored the same three with a comment block.
- `package.json` / `package-lock.json` -- added `twilio` dep.

---

## Key Decisions

1. **bcrypt cost 4 for SMS codes is intentional.** 6-digit codes + 5-10min
   TTL. sha256 would be rainbow-tabled in sub-seconds; bcrypt's salt blocks
   that, and cost 4 keeps verify fast. Documented inline.
2. **E.164 uniqueness gate is verified-only.** Another user owning the phone
   as `verified=true` blocks; an abandoned unverified hold doesn't.
3. **`verifyChallenge` increments attempts on success too.** No "save the
   correct guess for last" attacker strategy.
4. **Consume is atomic with audit.** `$transaction([identifier.update,
   code.update, authEvent.create])` -- audit hole impossible.
5. **`remove` blocks SMS 2FA active users.** Escape hatch is 15f's
   disable-2FA flow; refusing here prevents lockout.
6. **SMS 2FA login wiring is deferred to 15f.** Helpers exist but no route
   touches them -- keeps this step atomic and reviewable.
7. **E.164 normalisation is a regex placeholder.** Documented in code and
   in BUILD-LOG Known Gaps.

---

## Open Questions

1. **bcrypt cost 4 acceptable?** The brief explicitly said 4 and called out
   not to raise it. Flagging in case Richard wants a second opinion.
2. **Phone identifier uniqueness-verified-only.** Is it correct that an
   unverified claim on a number by user A does NOT block user B from
   starting verification on the same number? I said yes (abandoned hold
   shouldn't permanently lock a number). If wrong, the fix is a one-line
   change to the 409 guard.
3. **Pre-existing tsc error in `register/route.ts:36`** is out of scope but
   means `npx tsc --noEmit` is not clean on this branch. Logged in Known
   Gaps; escalating to Arch for whether to fix here or in a dedicated step.

---

## Verification

```
npx tsc --noEmit    -> 1 pre-existing error from 15d (register/route.ts:36);
                        0 new errors from 15e. Verified with clean-stash baseline.
npm test -- --run   -> 481/481 passing (438 baseline + 43 new).
```

Dev smoke:

```
# Register + login + call phone/add
POST /api/auth/register {...}    -> 201
POST /api/auth/login    {...}    -> 200 { requires2FA: false }
POST /api/account/phone/add {"phone":"+61400000000"}
  -> 200 {"sent":true}

# Direct sendSms() in dev mode (Twilio creds blank)
npx tsx -e 'sendSms({to:"+61400000000",body:"Your Kolaleaf code is 123456"})'
  -> stdout:
     [sms-dev] --------------------------------------
     [sms-dev] To:    +61400000000
     [sms-dev] Body:  Your Kolaleaf code is 123456
     [sms-dev] --------------------------------------
  -> { ok: true, id: "dev-mode" }
```

---

## Files to Review (priority order)

1. `src/lib/auth/phone.ts` -- normalisation + code gen + bcrypt cost choice.
2. `src/lib/auth/two-factor-challenge.ts` -- attempts-on-success behavior.
3. `src/app/api/account/phone/verify/route.ts` -- `$transaction` atomicity +
   5th-attempt-burns-code predictability.
4. `src/app/api/account/phone/add/route.ts` -- rate limit + 409 + upsert.
5. `src/app/api/account/phone/remove/route.ts` -- SMS-2FA guard + AuthEvent.
6. `src/lib/sms/{client,send}.ts` -- prod fail-fast + dev stdout fallback parity with email.

---

## Post-Review Fixes Applied

Richard flagged 1 Must Fix + 2 Should Fix in round 1. All addressed; re-verify
below.

### Must Fix 1 -- Cross-user phone hijack via abandoned unverified claim

**File:** `src/app/api/account/phone/add/route.ts:65-84`

Upsert `update` branch was empty, so a cross-user unverified claim kept its
original ownership; `/verify`'s `userIdentifier.update where:{identifier}`
would then flip the WRONG user's row to verified.

Fix:
- Upsert `update` now writes `{ userId, verified: false, verifiedAt: null }`
  -- ownership transfers to the caller, and any stale verifiedAt is wiped.
- `phoneVerificationCode.updateMany` invalidation scope dropped the `userId`
  filter (was `{userId, phone, usedAt:null}`, now `{phone, usedAt:null}`) so
  outstanding codes issued to the previous owner can't be replayed by the
  new owner.
- Defence-in-depth: the 409 guard at L49 still blocks when the existing row
  is `verified=true` and `userId !== caller`, so the only cross-user case
  that reaches the upsert is an unverified abandoned hold.

### Should Fix 1 -- Regression test (covered by Must Fix 1 test)

**File:** `tests/e2e/phone-verification.test.ts` (new)

End-to-end DB-level regression test:
1. Alice calls `/add` on `+61400099001` -- unverified identifier under Alice.
2. Bob calls `/add` on the same phone -- ownership must transfer to Bob.
3. Bob calls `/verify` with the issued code -- success.
4. Asserts:
   - exactly one `UserIdentifier` row for that phone
   - row owned by Bob
   - `verified=true`, `verifiedAt` set
   - `PHONE_VERIFIED` AuthEvent written under Bob, zero under Alice.
5. Plus a second case proving the 409 path still works when the pre-existing
   row is verified (Alice's ownership is NOT transferred away).

### Should Fix 2 -- verifyChallenge didn't burn consumedAt on attempt exhaustion

**File:** `src/lib/auth/two-factor-challenge.ts:68-89`

Pre-fix: hitting `attempts = MAX_ATTEMPTS` returned false but left
`consumedAt = null`; a spent challenge lingered with no consumedAt stamp
until expiry. Divergence from `/account/phone/verify` which burns on the
5th attempt.

Fix: when the incremented attempt count would equal `MAX_ATTEMPTS`, the
single update now sets `{ attempts: {increment:1}, consumedAt: now() }`
together. The success-path only stamps `consumedAt` if it wasn't already
stamped by the exhausting branch, so there's no double-write.

Tests added to `tests/lib/auth/two-factor-challenge.test.ts`:
- 5th attempt with a WRONG code: exhausting update carries
  `{attempts, consumedAt}`; a follow-up call with the CORRECT code fails
  because the challenge is now consumed.
- 5th attempt with a CORRECT code: returns true, and exactly ONE
  consumedAt-setting update is issued (no double-stamp).

### Phase D re-verify

```
npx tsc --noEmit    -> 0 errors (pre-existing register/route.ts:36 also clears now)
npm test -- --run   -> 485/485 passing (481 prior + 4 new regression/unit cases)
```
