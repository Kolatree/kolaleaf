-- Step 23: Permanent-failure sink for the email queue. One row per job
-- that exhausted its BullMQ retry budget — the worker writes here only
-- on the final-attempt failure path.
CREATE TABLE "FailedEmail" (
  "id"          TEXT PRIMARY KEY,
  "toEmail"     TEXT NOT NULL,
  "template"    TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "attempts"    INTEGER NOT NULL,
  "lastError"   TEXT NOT NULL,
  "failedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"  TIMESTAMP(3),
  "resolvedBy"  TEXT
);

CREATE INDEX "FailedEmail_toEmail_idx"    ON "FailedEmail"("toEmail");
CREATE INDEX "FailedEmail_failedAt_idx"   ON "FailedEmail"("failedAt");
CREATE INDEX "FailedEmail_resolvedAt_idx" ON "FailedEmail"("resolvedAt");
