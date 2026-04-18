-- Step 32 hardening: security anomaly detector runs a userId+createdAt
-- findMany on AuthEvent on every login and every transfer create. The
-- table has no supporting index and grows monotonically (AUSTRAC 7-
-- year retention), so the query degrades to a seq-scan. Add a
-- composite index on (userId, createdAt DESC) so the ORDER BY +
-- TAKE 50 is served from the index.
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent" ("userId", "createdAt" DESC);
