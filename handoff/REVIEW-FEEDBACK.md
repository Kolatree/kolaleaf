# Review Feedback — Step 15d
Date: 2026-04-15
Ready for Builder: YES

Reviewer: Richard
Scope: Resend integration + email verification + password reset flows.
Verified: `npx tsc --noEmit` → clean. `npm test -- --run` on the 8 new test files → 44/44 green. File list in REVIEW-REQUEST.md matches the working tree (12 new, 12 modified; no drift, no extras).

---

## Must Fix

None. The security bar for this wave is cleared.

---

## Should Fix

These do not block the step. Log to BUILD-LOG.md with a target step, or fix inline if it takes under five minutes. None of them would justify rolling back 15d.

- `src/app/api/auth/reset-password/route.ts:42-55` — password update, token-mark-used, and session delete are three separate statements. If the Node process dies between `user.update` and `passwordResetToken.update`, the password is rotated but the reset token is still replayable until its 1-hour TTL. Wrap the three writes (user.update, passwordResetToken.update, session.deleteMany) in `prisma.$transaction([...])` so the token is consumed atomically with the password change. The AuthEvent write can stay outside the transaction.

- `src/app/api/auth/verify-email/route.ts:31-34` — `updateMany` silently writes zero rows if the identifier referenced by the token no longer exists (e.g. user replaced their email between issuance and click). The route still renders the success page, giving the user false reassurance that a no-longer-present identifier is "verified." Inspect the result (`{ count }`) and fall through to `expiredPage()` when count === 0.

- `src/app/api/auth/verify-email/route.ts` (whole file) — no `AuthEvent` is written on successful email verification. `src/app/api/auth/reset-password/route.ts:57-63` correctly logs `PASSWORD_RESET`; this route should match with an `EMAIL_VERIFIED` event (userId, identifier, timestamp) for AML/CTF parity. CLAUDE.md is explicit that every authentication event, state transition, and admin action must be logged immutably. Email verification qualifies.

- `src/app/api/auth/request-password-reset/route.ts:39-48` — timing asymmetry: the "no account" branch skips the rate-limit count, token invalidation, token create, and sendEmail. Under load, an attacker can distinguish existing vs missing emails from response latency (a few ms of DB writes). The enumeration-safe response body is correct; the timing side channel is the gap. Not urgent — consider a constant-time pad (e.g. a small randomized delay on the no-account branch). Log to BUILD-LOG and revisit.

- `src/app/api/auth/request-password-reset/route.ts:40-42` — the lookup uses `findUnique({ where: { identifier: email } })` then filters on `type === 'EMAIL'` after the fact. If the project ever adds a non-EMAIL identifier that collides with an email string (unlikely but the schema allows it), the wrong branch is taken. Filter on `type: 'EMAIL'` at the DB layer with `findFirst` for defence in depth. Low priority.

- `src/lib/auth/middleware.ts:47-50` — `requireEmailVerified` uses `findFirst` ordered by `createdAt: 'asc'`, i.e. the oldest EMAIL identifier. If a user adds a second email later, this middleware gates on the original — which may not be the one they're currently trying to verify from `resend-verification`. Consistent today (resend-verification also picks the oldest), but fragile. Step 15g (phone identifiers) should flip both to an explicit primary flag. Flag for 15g, not 15d.

- `src/app/api/auth/register/route.ts:26-27` — the inline `length < 8` check duplicates `validatePasswordComplexity()` from `src/lib/auth/password.ts`. Bob added the helper in 15d but did not route the register route through it. Either route both through the helper, or keep the duplication and write a comment explaining why. Nuisance, not a defect.

---

## Escalate to Architect

1. **Password complexity baseline.** Bob flagged this in Open Questions. Current bar is `length >= 8`. For an AUSTRAC-registered money transmitter, `length >= 8` with no character class requirement is below industry norm. Two paths: (a) leave it and cover with TOTP 2FA once phone is wired in 15g, (b) raise to NIST 800-63B (min 12 chars + breach-dictionary check) with a one-time force-reset for existing users. Product + compliance decision. Arch and the Project Owner decide before 15g.

2. **Phone-identifier login gate.** Bob flagged this. The universal `!verified` gate was removed, not narrowed. When 15g adds phone identifiers, you will want to decide whether phone verification is also optional-at-login (user signs in on an unverified phone, gets a code) or required-at-login. Same question, different corridor. Log for 15g.

---

## Cleared

Reviewed `src/lib/auth/tokens.ts` (32-byte entropy, sha256 hash-only at rest, raw only in URL), `src/lib/email/{client,send,templates}.ts` (fail-fast in production, dev `[email-dev]` fallback, HTML escaping on user-controlled recipient names, IPs, and user-agents), all four new auth routes (token reuse blocked, expiry enforced, enumeration-safe response body on password-reset, force-logout on password change, 403 not 401 on unverified transfers, error body does not leak which identifier is unverified), the registration flow (fire-and-forget with `.catch` — no unhandled rejection, signup succeeds if Resend is down), the login relaxation (gate removed with a comment pointing at `requireEmailVerified`), the new `requireEmailVerified` middleware, the `POST /api/transfers` wiring (verify before KYC), and all 8 new test files (44/44 passing).

Token security: verified. Enumeration prevention: response body verified, timing side channel logged above. Token reuse: blocked at the SQL predicate level. Force-logout: `session.deleteMany` runs on reset. Hash-only storage: confirmed — raw token never written.

Step 15d is clear. Arch — proceed.
