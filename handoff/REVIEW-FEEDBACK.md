# Review Feedback — Step 15f-2
Date: 2026-04-15
Ready for Builder: YES

## Must Fix
None.

## Should Fix

- `src/lib/auth/two-factor-challenge.ts:54-94` — `verifyChallenge(challengeId, rawCode)` does not scope the lookup by `userId`. The 15f-2 brief asserted this check was already in place from 15e and asked Richard to confirm it. It is not there: `findUnique({ where: { id: challengeId } })` accepts any challengeId regardless of which user it was issued for.
  - Realistic exploit is bounded in 15f-2 because the three routes (`/enable`, `/disable`, `/regenerate-backup-codes`) mutate `User` scoped by `session.userId`, and an attacker still needs the raw SMS code that went to the challenge's target phone. Defense-in-depth, not a live privilege escalation in 15f-2.
  - Recommendation: add a `userId` parameter to `verifyChallenge(userId, challengeId, rawCode)` and `where: { id: challengeId, userId }`. Update the four call sites (the three in 15f-2 plus `src/app/api/auth/verify-2fa/route.ts`). Log to BUILD-LOG and fix inline with 15f (login-side 2FA), where it actually matters.

- `src/app/(dashboard)/account/_components/two-factor-section.tsx:357-361` — `requestSmsChallengeForDisable` is a dead-end: it fires an error message instead of making any request. The surrounding UI copy ("For SMS 2FA, use a backup code or the most recent SMS code sent at sign-in") already covers this path in `ViewEnabled`, so the "Can't find your code?" button is redundant. Either remove the button or wire it to a backup-code hint expansion. <5 minutes.

- `src/app/(dashboard)/account/_components/two-factor-section.tsx:199-216` — If `/api/account/me` returns non-OK (e.g. session silently expired), the UI falls back to `{ method: 'NONE' }` and lets the user click "Enable 2FA", which will then hit a 401 from `/setup`. Cleaner: detect 401 and redirect to `/login`, or show an explicit "unable to load account" error. Not blocking.

- `src/app/api/account/me/route.ts:38-44` — `maskPhone` returns `+61 ••• 678` with bullet characters, but the comment example on line 39 says `+61 4** *** 678`. Cosmetic comment/code mismatch. <5 minutes.

- `src/app/api/account/2fa/disable/route.ts:47, 63, 91` — `remainingBackupHashes` is only used to stamp `metadata.remainingBackupCodes: remainingBackupHashes.length` on the AuthEvent. After disable, `twoFactorBackupCodes` is cleared to `[]`, so "remaining" misleads. Rename to `backupCodesAtDisableTime` or drop. <5 minutes.

## Escalate to Architect
None.

## Cleared

Reviewed the five routes (`setup`, `enable`, `disable`, `regenerate-backup-codes`, `me`), the `TwoFactorSection` client component, `(dashboard)/account/page.tsx`, and the four test files Bob listed. Security surface is sound for 15f-2's scope:

- **Setup** (`src/app/api/account/2fa/setup/route.ts:22-98`): TOTP secret generated and returned but NOT persisted — confirmed no `prisma.user.update` in the TOTP branch. SMS branch requires a verified `PHONE` identifier (lines 74-80). `already_enabled` guard on line 36. `TWO_FACTOR_SETUP_INITIATED` AuthEvent written for both branches via `logAuthEvent`.
- **Enable** (`src/app/api/account/2fa/enable/route.ts:15-113`): atomic `$transaction` wraps `User.update` + `AuthEvent.create` (TOTP lines 51-68, SMS 86-103). TOTP verifies client-provided secret against code before persisting. SMS calls `verifyChallenge`. `already_enabled` guard line 35. Backup codes: 8 generated, raw returned once in `{ enabled, backupCodes }`, hashes persisted. `TWO_FACTOR_ENABLED` AuthEvent with `metadata.method`.
- **Disable** (`src/app/api/account/2fa/disable/route.ts:26-105`): three verification paths (TOTP secret, SMS challenge, backup-code fallback). Atomic transaction covers `User.update` (all 2FA columns cleared), `session.deleteMany where userId AND id NOT = currentSessionId`, and `TWO_FACTOR_DISABLED` AuthEvent. `not_enabled` guard line 41.
- **Regenerate** (`src/app/api/account/2fa/regenerate-backup-codes/route.ts:14-78`): same three verification paths. Atomic transaction replaces hashes, writes `TWO_FACTOR_BACKUP_CODES_REGENERATED`. Old hashes overwritten by the new array — old codes invalidated by replacement. `not_enabled` guard line 29.
- **GET /account/me** (`src/app/api/account/me/route.ts`): returns only `twoFactorMethod`, `twoFactorEnabledAt`, `hasVerifiedPhone`, masked phone, and backup-code count. No secret, no hashes, no raw identifier content.
- **UI** (`src/app/(dashboard)/account/_components/two-factor-section.tsx`): `'use client'` at top. Backup codes shown only while `mode.kind === 'backup-codes'`; `continueAfterBackupCodes` transitions mode to `{ kind: 'view' }` which drops the codes from state. "I've saved these" checkbox gates `Continue` (line 808). `navigator.clipboard.writeText` used for copy (line 385). Variant D tokens (`colors`, `radius`, `shadow`, `spacing`) used throughout; the few inline hex values are state-colour palette consistent with existing KolaPrimitives usage.
- **Auth gating**: every route calls `requireAuth` as its first `await`. Prisma errors handled via `AuthError` re-throw + generic `server_error` 500 with `console.error('[route-name]', error)`.
- **Tests**: 4 test files, ~24 tests. Coverage includes 401/auth failures, happy paths per method, invalid codes, already-enabled / not-enabled guards, force-logout assertion for disable (`id: { not: 's1' }`), and backup-code fallback.

Signal to Arch: **Step 15f-2 is clear.**
