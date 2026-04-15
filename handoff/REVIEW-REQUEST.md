# Review Request -- Step 15f-2

**Ready for Review:** YES
**Step:** 15f-2 -- 2FA setup API routes + /account UI section
**Builder:** Bob
**Date:** 2026-04-15

---

## Scope

Four API routes + one `/account` UI section to let authenticated users
enroll, manage, and disable 2FA. TOTP (authenticator app) and SMS methods.
Builds on 15f-1's TOTP helpers and 15e's SMS challenge helpers.

- `POST /api/account/2fa/setup` -- begin TOTP/SMS enrollment (secret not
  persisted yet for TOTP; SMS challenge issued).
- `POST /api/account/2fa/enable` -- verify code, commit 2FA state + 8 backup
  codes, write `TWO_FACTOR_ENABLED`.
- `POST /api/account/2fa/disable` -- verify code (or backup code), clear 2FA,
  force-logout all OTHER sessions, write `TWO_FACTOR_DISABLED`.
- `POST /api/account/2fa/regenerate-backup-codes` -- verify code, rotate
  backup codes, write `TWO_FACTOR_BACKUP_CODES_REGENERATED`.
- `GET /api/account/me` -- minimal summary consumed by the client component.
- `/account` UI: new `<TwoFactorSection>` replaces the "Manage in mobile app"
  placeholder.

No schema changes. No new deps.

---

## Files to review

### New API routes

- `src/app/api/account/2fa/setup/route.ts` (1-95)
  -- method validation, already-enabled gate, TOTP path with
     email-identifier lookup for otpauth label, SMS path with verified-phone
     gate, `TWO_FACTOR_SETUP_INITIATED` AuthEvent.
- `src/app/api/account/2fa/enable/route.ts` (1-110)
  -- TOTP/SMS code verification, 8-backup-code generation, `$transaction`
     that updates `User` + writes `TWO_FACTOR_ENABLED`. Raw backup codes
     returned ONCE in response body.
- `src/app/api/account/2fa/disable/route.ts` (1-100)
  -- tries primary method first (TOTP secret or SMS challenge), falls back
     to backup-code verification. `$transaction` clears 2FA columns,
     force-logs-out other sessions (`session.deleteMany where userId, id
     not = currentSessionId`), writes `TWO_FACTOR_DISABLED`.
- `src/app/api/account/2fa/regenerate-backup-codes/route.ts` (1-80)
  -- same verification, rotates hashes via `$transaction`, writes
     `TWO_FACTOR_BACKUP_CODES_REGENERATED`.
- `src/app/api/account/me/route.ts` (1-42)
  -- GET-only. Returns `twoFactorMethod`, `twoFactorEnabledAt`,
     `hasVerifiedPhone`, masked phone, backup-codes remaining count.
     Never exposes 2FA secret or hashes.

### UI

- `src/app/(dashboard)/account/_components/two-factor-section.tsx` (1-630ish)
  -- client component. State machine covers: view (on/off), picker (TOTP
     recommended, SMS disabled when no verified phone), TOTP setup
     (QR image + manual-entry secret + 6-digit input), SMS setup (input +
     Resend), backup-codes reveal (4x2 grid, Copy-all, save-ack checkbox
     gating Continue), disable (warn banner + current-code-or-backup input),
     regen (info banner + current-code input). Uses Variant D tokens from
     `@/components/design/KolaPrimitives` (`colors`, `radius`, `shadow`,
     `spacing`) -- no raw Tailwind state colours.
- `src/app/(dashboard)/account/page.tsx` (6-7, 125-126)
  -- added import + swapped the old 2FA placeholder card for
     `<TwoFactorSection />`. No other edits.

### Tests

- `tests/app/api/account/2fa/setup.test.ts` -- auth, method validation,
  already-enabled, TOTP happy, SMS happy, SMS phone-not-verified, TOTP
  email-required.
- `tests/app/api/account/2fa/enable.test.ts` -- auth, already-enabled,
  TOTP invalid, TOTP happy (verifies `$transaction`, `User.update` payload,
  AuthEvent), SMS invalid, SMS happy, missing-fields.
- `tests/app/api/account/2fa/disable.test.ts` -- auth, not-enabled,
  missing-code, TOTP-valid (verifies `session.deleteMany` with `id: {not:
  currentSessionId}`), backup-code fallback, SMS-valid, invalid-code.
- `tests/app/api/account/2fa/regenerate-backup-codes.test.ts` -- auth,
  not-enabled, TOTP-valid (verifies new hashes replace old), invalid.

---

## Phase D

- `npx tsc --noEmit`: PASS -- 0 errors.
- `npm test -- --run`: PASS -- 73 files / 520 tests (was 495; +25 new).
- Manual smoke: see sequence below.

### Manual smoke sequence

1. Log in to a verified test account; visit `/account`.
2. "Two-factor authentication" section shows "Off" pill + "Enable 2FA" CTA.
3. Click "Enable 2FA" -> picker shows TOTP (recommended) + SMS tiles. SMS
   tile is disabled with a hint if no verified phone is set.
4. Pick TOTP -> QR image renders + manual-entry secret below it + 6-digit
   input. Scan QR in an authenticator app (or use `oathtool --totp -b
   <secret>`). Enter the 6-digit code -> click Enable.
5. On success, backup-codes panel appears with 8 codes in a 4x2 grid.
   "Copy all" copies them to clipboard; the "I've saved these codes"
   checkbox gates the Continue button.
6. Click Continue -> section collapses back to the enabled view:
   "Authenticator app. Enabled <date>." with "Regenerate backup codes" and
   "Disable 2FA" buttons.
7. Log out; log in again with password -> `/verify-2fa` asks for code;
   supply one from the authenticator -> dashboard.
8. Back to `/account`; click "Disable 2FA" -> warn banner + code input.
   Enter a previously-saved backup code (or current TOTP code) -> Disable.
   Section flips back to "Off".
9. Re-enable 2FA via SMS (assuming a verified phone is set): picker ->
   Text-message tile -> SMS arrives, enter code, Enable -> backup codes
   shown -> Continue.
10. Click "Regenerate backup codes" -> info banner + code input. Enter
    current code -> new 8 codes appear, old ones invalidated server-side.

---

## Open questions

None. The brief resolved the SMS-disable UX question (accept backup code, OR
the client pre-calls `/setup` for a fresh challenge then posts `{code,
challengeId}` to `/disable`). Route header comments capture the same.

---

## Known gaps (not in scope for this step)

- No `/api/account/2fa/disable/request` route (brief resolved: not needed).
  SMS users who have lost access to their phone disable via a backup code.
- UI does not offer "I've lost my phone" recovery path beyond backup-code
  entry -- consistent with current scope.
- No React Testing Library tests for the UI component (project lacks the
  harness); manual smoke covers it per brief.

---

## Backup-code format sanity

`generateBackupCodes()` from 15f-1 returns 8 codes formatted as `XXXX-XXXXXX`
(10 alphanumeric chars + separator, ~50 bits entropy). Bcrypt cost 4 so
verify stays fast; list is tiny so a sequential compare is acceptable (and
the helper handles early-exit + remaining-list slicing correctly). Verified
end-to-end via tests.

---

## Post-Review Fixes Applied

Richard cleared 15f-2 with 0 Must Fix, 5 Should Fix. All 5 applied before
commit.

1. **verifyChallenge userId scoping (defense-in-depth)**
   - `src/lib/auth/two-factor-challenge.ts:54-62` — signature is now
     `verifyChallenge(userId, challengeId, rawCode)`, DB lookup switched
     from `findUnique({where:{id}})` to `findFirst({where:{id, userId}})`.
   - Call sites updated:
     - `src/app/api/account/2fa/enable/route.ts:78`
     - `src/app/api/account/2fa/disable/route.ts:53`
     - `src/app/api/account/2fa/regenerate-backup-codes/route.ts:38`
     - `src/app/api/auth/verify-2fa/route.ts:51`
   - Test updates in `tests/lib/auth/two-factor-challenge.test.ts`:
     every existing `verifyChallenge(...)` call now passes `userId`,
     mock switched from `findUnique` to `findFirst`, new cross-user
     regression test added ("refuses to verify a challenge that
     belongs to another user (cross-user scoping)").

2. **Dead-end SMS-disable button removed**
   - `src/app/(dashboard)/account/_components/two-factor-section.tsx`:
     deleted `requestSmsChallengeForDisable` helper and the
     "Can't find your code?" button. Deleted the
     `onRequestSmsChallenge` prop on `ViewEnabled`. Strengthened the
     SMS hint copy: "For SMS 2FA, enter one of your saved backup
     codes, or the most recent SMS code sent at sign-in."

3. **/me 401 handling**
   - `src/app/(dashboard)/account/_components/two-factor-section.tsx`:
     the initial `useEffect` load AND the `continueAfterBackupCodes`
     refresh both detect `res.status === 401` and redirect via
     `window.location.href = '/login'`, instead of falling through
     to a fake `method: 'NONE'` state that could invite re-enrollment
     from a logged-out session.

4. **maskPhone comment match**
   - `src/app/api/account/me/route.ts:38-46`: comment rewritten to
     show the actual bullet-ellipsis output (`+61 ••• 678`) instead
     of the old asterisk example.

5. **remainingBackupCodes AuthEvent field dropped**
   - `src/app/api/account/2fa/disable/route.ts:45-92`: removed the
     `remainingBackupHashes` local and the misleading
     `remainingBackupCodes` metadata field on the
     `TWO_FACTOR_DISABLED` event (backup codes are cleared in the same
     transaction, so a pre-disable count was only going to mislead
     future auditors). Metadata now carries just
     `{viaBackupCode: boolean}`.

### Post-fix Phase D

- `npx tsc --noEmit`: PASS — 0 errors.
- `npm test -- --run`: PASS — 73 files / 521 tests
  (was 520; +1 cross-user regression).
