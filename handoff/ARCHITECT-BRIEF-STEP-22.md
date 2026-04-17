# Architect Brief — Step 22: `User.state` Postgres Enum
*Written by Arch. Read by Bob (builder) and Richard (reviewer).*

---

## Goal

Migrate the `User.state` column from `TEXT` to a Postgres native
`ENUM` of the 8 Australian states, keeping the column nullable.
Postgres then enforces the constraint at the DB boundary; `AU_STATES`
in TypeScript remains the single source of truth for human-facing
option lists.

Small, self-contained schema tightening. Independent of Step 20
(Zod) and Step 21 (identifier union). Ships in parallel with any of
them in terms of correctness.

---

## Why now

- `User.state` is currently `String?` with only route-level validation
  (`AU_STATE_SET`). A bug in `/complete-registration` (or any future
  insert path) could silently write garbage like `'Nsw'` or `'nsw '`
  to the DB.
- Postgres enum is a 1-line-per-value constraint that cannot be
  bypassed. AUSTRAC audit posture: "data has the shape we claim it
  has" — belt-and-braces with the route validator.
- Only **one** write path (`/api/v1/auth/complete-registration`),
  **one** read path (the register form), **one** E2E assertion.
  Tiny blast radius.
- Zero backfill needed: all pre-migration rows have NULL (column
  was added in `20260417035232`), and we keep NULL as a valid value
  for post-migration rows too.

---

## Decisions Locked

| Question | Decision |
|---|---|
| Enum name | **`AuState`** (PascalCase Prisma convention; maps to Postgres `"AuState"` type). |
| Values | `NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`, `ACT`, `NT` — exactly the 8 values in `AU_STATES`. Order preserved. |
| Nullability | **Nullable (`state AuState?`).** Pre-wizard legacy users have NULL; keep the column optional until a KYC backfill lands. No sentinel. |
| Backfill | **None.** All existing NULLs stay NULL. No data transformation. |
| TypeScript source of truth | **`AU_STATES` in `src/lib/auth/constants.ts` remains authoritative for the `<select>` options.** Prisma's generated `$Enums.AuState` is imported where a DB-typed value is needed (insert payloads, read types). A single-source test asserts the two sets are identical — drift is caught. |
| Route validator | **Remove the runtime `AU_STATE_SET.has(state)` guard.** Zod + Prisma now enforce the constraint. Keep the `toUpperCase()` normalisation — defence against the wire receiving lowercase. |
| Migration cast | **`ALTER COLUMN "state" TYPE "AuState" USING "state"::"AuState"`.** Explicit cast because Postgres does not implicitly convert `TEXT → ENUM`. NULL casts cleanly; empty strings would fail but none exist. |
| Deploy ordering | **Migration must land BEFORE the app build that imports the new enum type.** Prisma migrate deploy runs in Railway's release phase; app boot is post-release. Safe by default on Railway. |

---

## Schema Changes

### `prisma/schema.prisma`

```prisma
enum AuState {
  NSW
  VIC
  QLD
  WA
  SA
  TAS
  ACT
  NT
}

model User {
  // ...existing fields...
  state       AuState?   // was: state String?
  // ...existing fields...
}
```

### Migration file — `prisma/migrations/<timestamp>_user_state_enum/migration.sql`

```sql
-- Create the AuState enum
CREATE TYPE "AuState" AS ENUM ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT');

-- Convert the column. USING clause is required — Postgres won't
-- implicitly cast TEXT → ENUM. Any non-enum value would raise here;
-- by construction (route validates against AU_STATE_SET) only the
-- 8 allowed values + NULL exist in the table.
ALTER TABLE "User"
  ALTER COLUMN "state" TYPE "AuState"
  USING "state"::"AuState";
```

**Pre-flight check Bob MUST run before generating the migration:**

```sql
-- Against local dev DB (and prod, read-only):
SELECT DISTINCT state FROM "User" WHERE state IS NOT NULL;
```

Expected: a subset of the 8 enum values. **If anything else appears**
(e.g., `'Nsw'`, `'  NSW  '`, `'New South Wales'`), STOP and escalate
to Arch. Do not run the migration until the dirty rows are
normalised, because the `USING "state"::"AuState"` cast will raise
on any non-enum string and the migration will fail in prod.

---

## Code Changes

### `src/app/api/v1/auth/complete-registration/route.ts`
- Remove the `AU_STATE_SET.has(stateUpper)` guard (now DB-enforced).
- Keep `toUpperCase()` and `trim()` — normalisation at the boundary.
- Change the inline request-body type / Zod schema (if Step 20 has landed) from `z.string()` to `z.enum(AU_STATES)` → Prisma accepts the value directly.

### `src/app/(auth)/register/details/page.tsx`
- No change. Still reads `AU_STATES` for the `<select>` options. Submits uppercase codes.

### `src/lib/auth/constants.ts`
- Add ONE new export: `AU_STATES_SYNC_CHECK` — `import type { $Enums } from '@/generated/prisma/client'; type _SyncCheck = Extract<$Enums.AuState, AuState>` type-level assertion that the two sets match. If Prisma ever drops a value, `tsc` breaks the build.

### `tests/e2e/register-wizard.test.ts`
- Line 123: no change (the assertion `user.state === 'NSW'` still holds; Prisma now returns the narrow enum type).

---

## Required Tests (TDD-first)

Write these FIRST, confirm they fail or pass as expected:

### New tests

1. **`tests/prisma/user-state-enum.test.ts`** — 4 cases
   - Inserting `state: 'NSW'` via Prisma succeeds.
   - Inserting `state: null` succeeds.
   - Inserting `state: 'Nsw'` (wrong case) fails with a Prisma runtime error — validates the enum is enforced.
   - Inserting `state: 'ZZZ'` (nonexistent) fails.

2. **`tests/lib/auth/constants-prisma-sync.test.ts`** — 1 case
   - `AU_STATES` array matches the values of `$Enums.AuState` exactly (sort and compare). Belt-and-braces for drift.

### Existing tests (verify still green)

3. **`tests/app/api/v1/auth/complete-registration.test.ts`** — existing 14 cases
   - The "invalid state" case (currently asserts 400 from route-level check): update to assert the new error shape. If Step 20 has landed, Zod returns 422; otherwise Prisma returns a different error. Pick the one matching the code at Bob's time.

4. **`tests/e2e/register-wizard.test.ts`** — existing 3 cases pass unchanged.

Expected test count delta: +5, -0.

---

## Verification Checklist (Bob, before REVIEW-REQUEST)

- [ ] Pre-flight `SELECT DISTINCT state FROM "User"` on local dev DB returned only enum-legal values or NULL.
- [ ] `npx prisma migrate dev --name user_state_enum` ran clean against local DB. Migration file in repo matches the expected SQL above.
- [ ] `npx prisma generate` ran. `$Enums.AuState` appears in `src/generated/prisma/client` types.
- [ ] `npm test -- --run` → previous count + 5 passing.
- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] `rm -rf .next && npm run build` → success.
- [ ] Local smoke: register wizard end-to-end, confirm `state` written as enum value.
- [ ] Rollback plan verified: `git revert HEAD` + `prisma migrate resolve --rolled-back <migration>` + `DROP TYPE "AuState"` reverts cleanly.

---

## Deploy Plan (Arch)

- Prisma migrate deploy runs on Railway release phase — safe ordering is built in.
- **Pre-prod:** run `SELECT DISTINCT state FROM "User"` against prod DB (read-only). Abort deploy if any non-enum value found. No known risk — all prod inserts go through the validated route — but the cost of checking is 10 seconds.
- Rollback is a single `git revert` + resolve the migration (Prisma supports this). Zero data loss: NULL→NULL, enum→TEXT back-conversion is implicit.

---

## Non-goals

- Postcode-vs-state range validation (NSW=2000-2999 etc). Separate hygiene, not this step.
- International states (international addressing is a post-launch feature).
- User lifecycle status (`active`, `suspended`, etc) — different concept, different column, not this step.
- Backfilling NULL state rows — not this step; KYC team owns backfill when international launches.

---

## Files Bob will touch (expected ~8)

- **New** (3): `prisma/migrations/<timestamp>_user_state_enum/migration.sql`, `tests/prisma/user-state-enum.test.ts`, `tests/lib/auth/constants-prisma-sync.test.ts`
- **Modified** (4): `prisma/schema.prisma`, `src/app/api/v1/auth/complete-registration/route.ts`, `src/lib/auth/constants.ts`, `tests/app/api/v1/auth/complete-registration.test.ts`
- **Regenerated** (1): `src/generated/prisma/client/**` — auto-regenerated by `prisma generate`. Include the diff in the commit (or ignore via .gitignore policy — match existing project convention).

Commit title (local only, no push): `Step 22: User.state → Postgres AuState enum`
