# Review Feedback -- Steps 2 + 3
Date: 2026-04-14
Ready for Builder: NO

---

## Must Fix

1. **prisma/schema.prisma:225 -- AuthEvent onDelete: Cascade will destroy audit trail on user deletion.** The AuthEvent model has `onDelete: Cascade` on the User relation. CLAUDE.md states: "All authentication events, state transitions, and admin actions must be logged immutably. Records retained 7 years per the AML/CTF Act." If a user is deleted, every authentication event (LOGIN, LOGIN_FAILED, REGISTER) is destroyed. This violates AUSTRAC's 7-year retention requirement. Change to `onDelete: Restrict` (or `SetNull` with userId made optional, depending on architect's preference). This applies to the migration SQL as well -- the FK constraint currently reads `ON DELETE CASCADE`.

---

## Should Fix

1. **src/lib/auth/login.ts:22-24 -- Timing side-channel on identifier lookup.** When an identifier is not found, the function returns immediately with "Invalid credentials." When the identifier exists but the password is wrong, a `bcrypt.compare` runs first (~250ms at cost 12). An attacker can measure response time to enumerate which email/phone identifiers are registered. For a remittance platform, this leaks which users hold accounts. Fix: run a dummy `bcrypt.compare` against a pre-computed hash when the identifier is not found, so both paths take the same time.

2. **src/lib/auth/totp.ts:17-26 -- Backup codes stored as plaintext.** Bob flagged this himself in REVIEW-REQUEST-STEP2.md. The `generateBackupCodes` function returns plaintext codes that are stored in `User.backupCodes` as a `String[]`. If the database is breached, these codes are immediately usable. They should be bcrypt-hashed before storage, with only the plaintext shown to the user once at generation time. Verification would then compare user input against each stored hash. This is a standard practice for backup codes.

3. **src/lib/transfers/create.ts:95-98 -- Decimal values pass through toNumber().** `sendAmount.toNumber()`, `receiveAmount.toNumber()`, etc. convert `decimal.js` values to JavaScript floats before passing to Prisma. For the current value ranges (max 50,000 AUD, rates ~1042) this is safe, but it is a latent precision risk. Prisma accepts string values for Decimal fields. Prefer `sendAmount.toString()` or pass the Decimal object directly, which Prisma coerces correctly. This prevents future surprises if amounts or rates grow.

4. **src/lib/transfers/state-machine.ts:189 -- Happy-path test expects 6 events but createTestTransfer already creates 1.** The test at `tests/lib/transfers/state-machine.test.ts:194` expects 6 events (1 initial from helper + 5 transitions). This is correct but tightly coupled to the helper's implementation. If the helper changes, this test breaks silently. Not blocking, but worth a comment in the test.

---

## Escalate to Architect

1. **AuthEvent cascade rule -- Architect must decide the deletion strategy.** The immediate fix is changing `onDelete: Cascade` to `onDelete: Restrict` on AuthEvent, which means users with auth events can never be deleted. This is correct for compliance but means the system needs a separate "soft delete" or anonymization strategy for user account closure. Architect should specify: (a) Should we use `Restrict` and handle user closure via a `deactivated` flag? (b) Or use `SetNull` to preserve events but sever the FK link? Either way, the cascade must not destroy records.

2. **Registration creates session before email verification.** `register.ts` creates a session immediately on registration without verifying the email identifier. The `loginUser` function correctly blocks unverified identifiers for subsequent logins. So the user gets one 15-minute session, then cannot log in again until verified. Is this the intended flow? If so, the registration session should be flagged as "limited" or "unverified" in a future step. If not, the session should not be created until the email is verified.

---

## Cleared

**Step 2 -- Auth (7 files, 37 tests):**
Password hashing (bcrypt cost 12), session management (256-bit tokens, 15-min expiry, create/validate/revoke/revokeAll/cleanExpired), TOTP 2FA (otplib, secret generation, verification), multi-identifier identity (add/verify/find/list), registration (user + identifier + password + session + referral), login (identifier lookup + password verify + 2FA flag + audit), and audit logging (auth events with metadata). All 37 tests pass. Schema migration adds `passwordHash`, `totpSecret`, `totpEnabled`, `backupCodes` to User and creates `AuthEvent` model. Code is clean, well-structured, and follows established patterns.

**Step 3 -- Transfer State Machine (7 files, 51 tests):**
Transition map covers all 13 states with correct valid/invalid paths matching CLAUDE.md state diagram. State machine uses Prisma `$transaction` with optimistic locking via `updateMany` + status condition. Retry logic correctly caps at 3 and forces NEEDS_MANUAL. Daily limit calculation correctly excludes CANCELLED/EXPIRED/REFUNDED and uses UTC dates. All math uses decimal.js. Domain errors are well-defined (9 error classes). Cancellation is owner-only from CREATED/AWAITING_AUD only. Queries are ownership-scoped with cursor pagination. All 51 tests pass. The createTransfer function correctly gates on KYC verification, recipient ownership, corridor validity, amount range, and daily limit.

**Combined: 94 tests pass, 0 failures.**
