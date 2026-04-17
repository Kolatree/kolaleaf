-- Janitor sweeps filter on `claimExpiresAt < cutoff`. The existing
-- `@@index([expiresAt])` doesn't cover that path, so at scale the
-- delete-stale-claims query would sequential-scan. Adding the matching
-- index keeps the reap-pending-emails cron O(deleted) rather than
-- O(table).

-- CreateIndex
CREATE INDEX "PendingEmailVerification_claimExpiresAt_idx" ON "PendingEmailVerification"("claimExpiresAt");
