-- Step 22: Promote User.state from free-form TEXT to a Postgres native enum.
-- AU_STATES (8 values) match the single-source list in src/lib/auth/constants.ts.
-- Nullable preserved; pre-wizard legacy users keep their NULLs.

-- Create the AuState enum type.
CREATE TYPE "AuState" AS ENUM ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT');

-- Convert the column. USING clause is required — Postgres does not
-- implicitly cast TEXT -> ENUM. By construction every production insert
-- goes through /api/v1/auth/complete-registration, which validates
-- against AU_STATE via Zod before writing, so only the 8 allowed
-- values or NULL exist in the table.
ALTER TABLE "User"
  ALTER COLUMN "state" TYPE "AuState"
  USING "state"::"AuState";
