-- Widen PendingEmailVerification → PendingVerification (phone-first onboarding).
--
-- The pre-account claim row now supports both EMAIL and PHONE rails
-- via a `kind` discriminator and an `identifier` column that holds
-- either an email address or an E.164 phone number. The compound
-- unique on (kind, identifier) replaces the previous unique on email.
--
-- Migration shape: in-place ALTERs only (no data copy, no shadow
-- table). Safe to run with active traffic — every step is either
-- additive (ADD COLUMN with default) or a metadata-only rename. The
-- one risk is the unique constraint swap, which momentarily allows
-- duplicate (kind, identifier) pairs if two writers race the new
-- CREATE UNIQUE INDEX; in practice the table volume is tiny (one
-- row per in-flight wizard) and the swap completes in <100ms.
--
-- Rollback strategy:
--   ALTER TABLE "PendingVerification" RENAME TO "PendingEmailVerification";
--   ALTER TABLE "PendingEmailVerification" RENAME COLUMN "identifier" TO "email";
--   DROP INDEX "PendingVerification_kind_identifier_key";
--   ALTER TABLE "PendingEmailVerification" DROP COLUMN "kind";
--   CREATE UNIQUE INDEX "PendingEmailVerification_email_key" ON "PendingEmailVerification"("email");
-- (followed by reverting the rename of the three named indexes below).

-- 1. Add `kind` column with EMAIL default so existing rows backfill cleanly.
ALTER TABLE "PendingEmailVerification"
  ADD COLUMN "kind" "IdentifierType" NOT NULL DEFAULT 'EMAIL';

-- 2. Rename email → identifier (column is otherwise unchanged).
ALTER TABLE "PendingEmailVerification" RENAME COLUMN "email" TO "identifier";

-- 3. Drop the old unique on email (now identifier). The new compound
-- unique replaces it at step 7.
DROP INDEX "PendingEmailVerification_email_key";

-- 4. Rename the table. All existing rows preserved verbatim apart
-- from the column rename in step 2 and the new kind column from step 1.
ALTER TABLE "PendingEmailVerification" RENAME TO "PendingVerification";

-- 5. Rename indexes so they match the new table name. Postgres does
-- not auto-rename indexes when a table is renamed; explicit renames
-- keep `\d "PendingVerification"` legible in psql.
ALTER INDEX "PendingEmailVerification_pkey" RENAME TO "PendingVerification_pkey";
ALTER INDEX "PendingEmailVerification_claimExpiresAt_idx" RENAME TO "PendingVerification_claimExpiresAt_idx";
ALTER INDEX "PendingEmailVerification_expiresAt_idx" RENAME TO "PendingVerification_expiresAt_idx";

-- 6. Drop the EMAIL default once existing rows are backfilled. New
-- rows must specify kind explicitly via the Prisma client — no
-- silent EMAIL-defaulting can ever happen for a phone code.
ALTER TABLE "PendingVerification" ALTER COLUMN "kind" DROP DEFAULT;

-- 7. Add the new compound unique. Replaces the email-only unique
-- dropped in step 3; serves both rails of the wizard.
CREATE UNIQUE INDEX "PendingVerification_kind_identifier_key"
  ON "PendingVerification"("kind", "identifier");
