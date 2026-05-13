-- D2 (phone-first wave): narrow PendingVerification.kind from
-- `IdentifierType` (EMAIL | PHONE | APPLE | GOOGLE) to a dedicated
-- `PendingVerificationKind` (EMAIL | PHONE).
--
-- Rationale: APPLE and GOOGLE values of IdentifierType are valid at
-- the catalog level but NEVER written to PendingVerification — those
-- sign-in paths skip the pre-account code-claim flow because the IdP
-- token already proves identifier control. The previous schema left
-- this as a comment-only invariant. Now the type system enforces it:
-- a stray APPLE/GOOGLE write fails Prisma client validation before
-- reaching the database, and (as defense in depth) the column itself
-- can no longer hold those values.
--
-- Data safety: the only existing rows are EMAIL (legacy email-rail
-- verifications) and PHONE (added in the 20260513120000 migration).
-- The `USING ("kind"::text::"PendingVerificationKind")` cast goes
-- through text so Postgres can map the source enum's labels to the
-- target enum's labels. If — somehow — an APPLE or GOOGLE row exists
-- in PendingVerification at migration time, the cast fails because
-- those labels are absent from the target type, the ALTER aborts,
-- and the migration rolls back atomically. That failure mode is
-- exactly what we want: a data-integrity assertion that surfaces
-- BEFORE the constraint becomes a runtime trap.
--
-- AUSTRAC retention: PendingVerification holds pre-account PII
-- (email/phone before user creation). This migration changes only
-- the column's enum constraint — every row, every column value, and
-- every audit-relevant timestamp is preserved verbatim. The 7-year
-- retention window is unaffected because no rows are touched.
--
-- Rollback strategy (if a hotfix needs to readmit APPLE/GOOGLE):
--   ALTER TABLE "PendingVerification"
--     ALTER COLUMN "kind" TYPE "IdentifierType"
--     USING ("kind"::text::"IdentifierType");
--   DROP TYPE "PendingVerificationKind";

CREATE TYPE "PendingVerificationKind" AS ENUM ('EMAIL', 'PHONE');

ALTER TABLE "PendingVerification"
  ALTER COLUMN "kind" TYPE "PendingVerificationKind"
  USING ("kind"::text::"PendingVerificationKind");
