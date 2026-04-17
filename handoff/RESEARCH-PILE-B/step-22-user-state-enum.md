# Step 22 — User.state Postgres enum — research

## Confirmation

`User.state` represents an **AU address state** (NSW, VIC, QLD, etc.), NOT a user lifecycle state. Confirmed by its position in the schema directly between `city` and `postcode`, and by the adjacent comment "AU-only address for v1". The `complete-registration` route validates it against `AU_STATE_SET` and stores it uppercase. No lifecycle `state` column exists anywhere on the User model.

## Current schema

- column type: `String?` (nullable TEXT in Postgres)
- default: none — column is NULL until `/api/auth/complete-registration` runs
- added via migration `20260417035232_pending_email_verification_and_address` as `ALTER TABLE "User" ADD COLUMN "state" TEXT`

## AU_STATES constant

- path: `src/lib/auth/constants.ts` lines 4–6
- values: `['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']`
- also exports `AuState` (union type) and `AU_STATE_SET` (ReadonlySet for O(1) validation)

## Read/write call sites

| File | Line | Purpose |
|------|------|---------|
| `src/app/api/auth/complete-registration/route.ts` | 75, 98, 136, 222 | Reads from request body, validates against `AU_STATE_SET`, normalises to uppercase, writes to `user.state` via `tx.user.create` |
| `src/app/(auth)/register/details/page.tsx` | 48, 164 | Form input — populates `<select>` from `AU_STATES`, submits as `state: stateCode` |
| `tests/e2e/register-wizard.test.ts` | 123 | Asserts `user.state === 'NSW'` |

No other Prisma read of `user.state` found (e.g., no profile/dashboard route reads it yet).

## Other "state" columns

- `app/(dashboard)/account/_components/two-factor-section.tsx` uses a local TypeScript type `TwoFactorState` — unrelated to any DB column
- `Recipient` model has no `state` column
- No other model in `schema.prisma` has a column named `state`

## Existing seed/migration values

- `prisma/seed.ts` does not set any User rows — seed only creates the AUD-NGN corridor and an initial rate
- Migration `20260417035232` adds the column as nullable with no DEFAULT — all pre-migration rows (test users from earlier steps) have NULL
- The one live data source is `complete-registration`, which stores uppercase abbreviated codes (e.g., `NSW`)

## Open questions for Arch

1. Allow NULL after enum migration (for pre-registration users) or backfill NULL rows to a sentinel like `UNKNOWN`? Given the comment "pre-wizard test users stay migration-safe", nullable seems intentional — confirm.
2. Postgres `ALTER COLUMN … TYPE … USING` cast: will `TEXT → AuState enum` succeed without a `USING` clause, or is an explicit cast needed?
3. Should `AU_POSTCODE_RE` validation be extended to validate postcode-vs-state ranges (e.g., NSW = 2000–2999) in a follow-on step, or out of scope?
