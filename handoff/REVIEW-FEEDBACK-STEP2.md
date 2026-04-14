# Review Feedback — Step 2
Date: 2026-04-14
Ready for Builder: NO

## Must Fix

- `src/lib/auth/totp.ts:17` — Backup codes are stored as plaintext in the `backupCodes` String[] field on User. The review request itself flags this: the brief says backup codes must be bcrypt-hashed before storage. Plaintext backup codes in the database are a security liability for an AUSTRAC-registered money transmitter. If the DB is compromised, every user's backup codes are immediately usable. — Hash each backup code with bcrypt (cost 12) before writing to `user.backupCodes`. The `generateBackupCodes` function should return the plaintext codes to show the user once, and a separate array of hashes for storage. Verification should bcrypt-compare the submitted code against all stored hashes.

- `src/lib/auth/register.ts:27-37` — Registration does not create the email identifier as `verified: true`. The identifier defaults to `verified: false` (per schema line 95). But `loginUser` at `src/lib/auth/login.ts:26-28` rejects login for unverified identifiers. This means a user who just registered cannot log in. The registration test at `register.test.ts:46-53` confirms a session is created at registration, but if that session expires (15 minutes), the user is permanently locked out because no email verification flow exists yet. — Either mark the email identifier as `verified: true` at registration time (since the user just typed the email), or document this as a known gap requiring an email verification step before the user can re-login. Given that this is service-layer-only with no routes yet, marking as verified at registration is the pragmatic fix. The login tests work around this by manually calling `verifyIdentifier` in the helper (`login.test.ts:31-34`), which masks the real-world problem.

- `src/lib/auth/register.ts:40-53` — The referral lookup and session creation happen outside the `prisma.user.create` transaction. If the referral lookup or session creation fails after the user is created, the database is left in an inconsistent state: a user exists with no session and no referral link. — Wrap the entire registration flow (user create, referral link, session create, audit log) in a single `prisma.$transaction()`.

## Should Fix

- `src/lib/auth/sessions.ts:20` — `validateSession` looks up by token using `findUnique`. The token field is unique-indexed (schema line 104), so this works. However, for an expired session, the function returns `null` silently without cleaning up the expired row. Expired sessions accumulate until `cleanExpiredSessions` is called. — Not a bug, but ensure `cleanExpiredSessions` is called on a schedule (background job). Log this to BUILD-LOG as a known gap if no background worker exists yet.

- `src/lib/auth/login.ts:38-45` — Failed login attempt logs the auth event but does not implement rate limiting or account lockout. After N failed attempts, the account should be temporarily locked or throttled. — Log to BUILD-LOG as a known gap for a future step. This is a security concern for a money transmitter but is out of scope for the service layer foundation.

- `src/lib/auth/totp.ts:12-14` — `verifyTotpToken` calls `verifySync({ token, secret })` which returns `{ valid, delta, epoch, timeStep }`. The code correctly accesses `.valid`. However, the function does not accept or configure a time window. The otplib default allows +/- 1 step (30 seconds each way). This is standard and acceptable. No fix needed, but documenting for the record.

- `src/lib/auth/audit.ts` — The `event` field is a free-form `String` in the schema (schema line 221), not an enum. This means any arbitrary string can be logged as an auth event type. — Consider defining an enum for auth event types (LOGIN, LOGIN_FAILED, REGISTER, LOGOUT, SESSION_REVOKED, TOTP_ENABLED, etc.) in a future step to prevent typos and enable querying. Log to BUILD-LOG.

## Escalate to Architect

- **Backup code hashing scope**: Bob flagged this in the review request. The brief says hash backup codes with bcrypt. Bob deferred, asking for confirmation. I am marking it as Must Fix because storing plaintext secrets in a money transmitter database is not acceptable. If Architect disagrees on timing, Architect can override, but this reviewer will not clear the step with plaintext backup codes.

- **Email verification flow**: Registration creates an unverified email identifier. No verification mechanism exists. This is a product decision: should Step 2 include a basic email verification flow, or should registration mark the email as pre-verified? The current code creates a state where users cannot re-login after session expiry.

## Cleared

Password hashing uses bcrypt with cost factor 12 (verified in test and source). Session tokens are `crypto.randomBytes(32)` producing 64-character hex strings with 15-minute expiry (verified). TOTP uses otplib defaults: SHA1, 30-second window, 6-digit codes (verified by running otplib in Node). `revokeAllUserSessions` deletes all sessions via `deleteMany` (verified). Password hash is stored on the User model directly, not a separate table (verified in schema). No API routes exist -- service layer only (verified). All 37 auth tests pass. Audit logging is present on registration, login success, and login failure. TDD discipline confirmed: test files exist for every source file (7 source, 7 test files).
