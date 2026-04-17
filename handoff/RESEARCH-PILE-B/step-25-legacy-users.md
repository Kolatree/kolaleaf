# Step 25 — Legacy test-user cleanup — research

## Known legacy rows

No specific emails recorded in handoff docs or code. The ARCHITECT-BRIEF (line 47) says:
> "Existing unverified test users in prod — **Delete post-deploy.** Only 2 rows; they're test data."
> "Migration stays backfill-safe. The 2 existing test users become grandfathered (Arch deletes them manually after deploy)."

Identifying criteria: `User` rows where `country IS NULL` AND `addressLine1 IS NULL` (address columns were added in migration `20260417035232`; all real post-wizard users will have them populated by `/complete-registration`). Additionally, their `UserIdentifier.verified = false` (they pre-date the verify-first wizard). Arch should confirm via:
```sql
SELECT u.id, ui.identifier, u."createdAt"
FROM "User" u
JOIN "UserIdentifier" ui ON ui."userId" = u.id
WHERE u."addressLine1" IS NULL AND ui.verified = false;
```

## Affected tables (to clean)

- `User` — the 2 rows themselves
- `UserIdentifier` — CASCADE on `onDelete: Cascade` (auto-deleted)
- `Session` — CASCADE (auto-deleted)
- `EmailVerificationToken` — CASCADE (auto-deleted)
- `PasswordResetToken` — CASCADE (auto-deleted)
- `PhoneVerificationCode` — CASCADE (auto-deleted)
- `TwoFactorChallenge` — CASCADE (auto-deleted)
- `Referral` — `onDelete: Restrict` — must check and delete manually before User deletion
- `Recipient` — `onDelete: Restrict` — must check and delete manually before User deletion
- `Transfer` — no `onDelete` clause (defaults to Restrict in PG) — must check before deletion
- `PendingEmailVerification` — keyed by email, no FK; query by email to clean up orphan rows if any

## Tables to preserve (AUSTRAC)

- `TransferEvent` — CLAUDE.md: "Never delete rows from this table." Delete only if the parent `Transfer` is also test-only.
- `AuthEvent` — `onDelete: Restrict`. These are the immutable audit trail. **Do not delete.** Arch must decide: either leave orphaned (userId still present as string) after User deletion, or accept that test AuthEvents are not subject to the 7-year rule (no real customer).
- `ComplianceReport` — no FK; references userId/transferId as nullable strings. Leave as-is.
- `WebhookEvent` — no FK to User; unaffected.

## Existing cleanup scripts

None. No `scripts/` directory exists in the project.

## Test-suite collisions

No collision risk. All test emails use `Date.now()`-suffixed patterns:
- `sec-pw-${Date.now()}@test.com`, `jane-${Date.now()}@test.com`, `auth-e2e-${Date.now()}@test.com`, etc.
- One static fixture: `u@example.com` in `tests/app/api/account/2fa/setup.test.ts` — mocked Prisma, never hits prod DB.

## Open questions for Arch

1. The 2 test users' actual emails/IDs are not recorded anywhere in code or handoff docs. Arch needs to identify them by SQL before scripting deletion (suggest the `addressLine1 IS NULL AND verified = false` query above).
2. Do the `AuthEvent` rows for these test users need to be preserved for AUSTRAC, or are they exempt as never-real-customer records? If exempt, deletion order: AuthEvent → User.
3. Did either test user have any `Transfer` rows (unlikely but check — `TransferEvent` preservation depends on this answer).
4. Is there a PII-scrub requirement (zero-out PII fields) rather than hard deletion, per any internal data-handling policy beyond AUSTRAC minimum?
