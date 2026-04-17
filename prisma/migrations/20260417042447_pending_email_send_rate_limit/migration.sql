-- Rate-limit counters for /send-code. The previous design relied on
-- counting rows in PendingEmailVerification within a time window, but
-- because that table is upsert-keyed by email (one row per address),
-- count(createdAt >= now-1h) returned 0 or 1 forever and the 5/hour
-- cap never fired. We now track send count + window start on the row
-- and increment atomically. Defaults make the migration backfill-safe
-- for the single seed-phase row that exists today.

-- AlterTable
ALTER TABLE "PendingEmailVerification"
  ADD COLUMN "sendCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sendWindowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
