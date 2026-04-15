# Review Feedback — Step 15f-1
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix
- `src/app/api/auth/verify-2fa/route.ts` — No dedicated unit test file (`tests/app/api/auth/verify-2fa.test.ts`) exists. The three verification paths (TOTP, SMS, backup-code) plus the `NONE`, invalid-JSON, missing-code, and 401 branches are only exercised indirectly via `tests/e2e/auth-lifecycle.test.ts` and `tests/app/api/auth/login.test.ts`. A direct route test would lock in the branch behaviour — particularly that the backup-code path runs as a fall-through when TOTP/SMS don't match, that the consumed hash is actually removed from the DB, and that `metadata.method` is written correctly per path. Log in BUILD-LOG as a follow-up if not fixed inline — do not expand the scope of 15f-1 for it.

## Escalate to Architect
None.

## Cleared
Reviewed the scope of Step 15f-1 — the legacy-to-new 2FA field migration:

- **Migration SQL** (`prisma/migrations/20260415131516_drop_legacy_2fa_columns/migration.sql`) is exactly the three `DROP COLUMN` statements for `backupCodes`, `totpEnabled`, `totpSecret`. No other operations. Consistent with the pre-launch, no-production-users stance per the 15f brief.
- **Schema** — `User` model (`prisma/schema.prisma` lines 74-99) no longer declares the legacy fields. New fields `twoFactorMethod`, `twoFactorSecret`, `twoFactorBackupCodes`, `twoFactorEnabledAt` are in place.
- **`src/app/api/auth/verify-2fa/route.ts`** rewritten end-to-end. `requireAuth` enforced. Input validation rejects non-string/missing `code` with 400. `twoFactorMethod === 'NONE'` returns 400. TOTP path gated on `twoFactorMethod === 'TOTP' && user.twoFactorSecret`. SMS path gated on `twoFactorMethod === 'SMS' && challengeId`, delegating to `verifyChallenge`. Backup-code path falls through regardless of primary method; on success the consumed hash is removed via `prisma.user.update` and `AuthEvent` written with `metadata.method: 'BACKUP_CODE'` and `remaining` count. Invalid code returns 401. Errors caught, `console.error('[auth/verify-2fa]', error)` logged, generic 500 returned. `AuthError` surfaces its own `statusCode`.
- **`src/lib/auth/login.ts`** reads only `user.twoFactorMethod` (line 68). SMS path fails closed — if `twoFactorMethod === 'SMS'` but no verified `PHONE` identifier exists, `LOGIN_FAILED` is logged with `reason: 'sms_2fa_enabled_without_phone'` and the function throws. No silent downgrade to no-2FA.
- **`src/lib/auth/totp.ts`** — new helpers (`generateTotpSecret`, `buildOtpauthUri`, `generateQrCodeDataUrl`, `verifyTotpCode`, `generateBackupCodes`, `verifyBackupCode`) are in place. Backup codes bcrypt-hashed before storage (cost 4, salted). `verifyBackupCode` returns `remainingHashes` with the used entry spliced out so the route can persist single-use semantics.
- **No legacy field references** anywhere in `src/` or `tests/`. `tldr search` on `totpSecret`, `totpEnabled`, and `user.backupCodes` returns zero hits under `src/` and `tests/`. The only remaining mentions are in historical handoff docs (`ARCHITECT-BRIEF.md`, `BUILD-LOG.md`, prior `REVIEW-REQUEST-*.md`) and the two migration SQL files themselves — expected and correct.
- **Scope respected.** `git diff HEAD --name-only` shows no changes to `src/app/api/account/2fa/*` or `src/app/(dashboard)/account/page.tsx`. 15f-2 work correctly deferred.
- **TSC clean.** `npx tsc --noEmit` completes with no errors.
- **Tests green.** `npm test` → 69 files, 495 tests, 0 failures, 42s.

Step 15f-1 is clear.
