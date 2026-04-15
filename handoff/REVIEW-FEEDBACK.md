# Review Feedback — Step 15c
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix
None. Bob's evidence and my independent pass agree end-to-end.

## Escalate to Architect
None.

## Verified Working

**1. Migration is purely additive.**
`prisma/migrations/20260415113525_auth_verification_2fa/migration.sql` — walked line by line. Contains only:
- 1 × `CREATE TYPE` (TwoFactorMethod: NONE/TOTP/SMS)
- 4 × `ADD COLUMN` on User (twoFactorMethod NOT NULL DEFAULT 'NONE', twoFactorSecret nullable, twoFactorBackupCodes TEXT[] DEFAULT ARRAY[]::TEXT[], twoFactorEnabledAt nullable)
- 4 × `CREATE TABLE` (EmailVerificationToken, PasswordResetToken, PhoneVerificationCode, TwoFactorChallenge)
- 2 × `CREATE UNIQUE INDEX` (tokenHash on Email + Password reset)
- 8 × `CREATE INDEX` (userId + expiresAt on all four new tables)
- 4 × `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE CASCADE ON UPDATE CASCADE`

No `DROP`, no `ALTER ... RENAME`, no `ALTER ... DROP COLUMN`. `grep -E "DROP|RENAME"` returns nothing. Safe to deploy against existing data.

**2. Defaults are safe for existing users.**
- New enum `twoFactorMethod` defaults to `NONE` — existing rows pick this up.
- `twoFactorBackupCodes` defaults to empty array `ARRAY[]::TEXT[]` — no NULL issues.
- `twoFactorSecret` + `twoFactorEnabledAt` are nullable — no backfill needed.
No migration risk for existing User rows.

**3. No application code touched.**
`git diff HEAD -- src/ tests/` returns nothing. Only schema, migration, and handoff docs changed. `src/generated/prisma/**` is correctly gitignored, so Bob's regeneration does not pollute the diff.

**4. Brief compliance — schema additions match.**
- `prisma/schema.prisma:63-67` — `TwoFactorMethod` enum (NONE, TOTP, SMS). Correct.
- `prisma/schema.prisma:78-82` — 4 new User fields with correct defaults. Correct.
- `prisma/schema.prisma:96-100` — 4 back-relations added. Correct.
- `prisma/schema.prisma:252-313` — 4 new models, each with `@@index([userId])`, `@@index([expiresAt])`, and `onDelete: Cascade`. Correct.

**5. `UserIdentifier.verified` remains source of truth.**
`grep -E "emailVerified|phoneVerified" prisma/schema.prisma` → no matches. `UserIdentifier.verified` + `verifiedAt` (schema.prisma:110-111) unchanged. Correct — no duplicate state introduced on User.

**6. Legacy 2FA coexistence — intentional, documented, not a blocker.**
`User.totpSecret` (line 78), `User.totpEnabled` (line 79), `User.backupCodes` (line 80) all still present on the User model. Not renamed, not dropped, no semantic change. Arch's carry-forward note in `ARCHITECT-BRIEF.md:169-175` ("logged 15c → addressed in 15f") explicitly authorizes this coexistence and schedules the removal for Step 15f with the application-code migration. Behavioural safety confirmed: new fields default to `NONE` / empty so existing `login.ts` / `verify-2fa/route.ts` paths are untouched.

**7. Specific per-model checks.**
- `EmailVerificationToken.tokenHash @unique` — yes (migration:66).
- `PasswordResetToken.tokenHash @unique` — yes (migration:75).
- `PhoneVerificationCode.codeHash` — present, NOT unique — correct for short numeric codes that may reissue.
- `TwoFactorChallenge.codeHash String?` — nullable. Correct for the TOTP path which stores no code.
- `TwoFactorChallenge.method` — schema cannot enforce "not NONE"; enforcement is app-layer intent. Acceptable per Bob's read in Request #6.
- Index coverage: each of the four new tables has exactly `@@index([userId])` + `@@index([expiresAt])`. Two singles are the right call — PK lookups dominate, and the cleanup sweep is a range scan on `expiresAt` alone. A composite would only help a query like `WHERE userId = ? AND expiresAt < now()`, which isn't the planned shape. Agreed with Bob.
- Cascade-on-user-delete on all four FKs — correct from a compliance standpoint. Pending tokens/codes/challenges are ephemeral artifacts; the immutable audit log (AuthEvent, transferEvent) remains on `onDelete: Restrict` elsewhere, preserving AUSTRAC 7-year retention.

## Cleared
Schema-only Step 15c: 1 new enum, 4 new User columns, 4 new models, 8 single-column indexes, 2 unique constraints, 4 cascade FKs. Purely additive, no application code changes, legacy 2FA fields correctly left in place for the 15f follow-up.

Step 15c is clear.
