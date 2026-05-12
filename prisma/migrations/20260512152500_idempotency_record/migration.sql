-- IdempotencyRecord: money-path duplicate-suppression for POST /api/v1/transfers.
-- See prisma/schema.prisma `model IdempotencyRecord` for semantics.
--
-- AUSTRAC note: dedup returns the original Transfer + preserves its
-- TransferEvent audit row. Replay never skips audit; only new transfers
-- create new events.

CREATE TABLE "IdempotencyRecord" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "transferId"  TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- Composite uniqueness: a single (userId, key) pair is the dedup key.
CREATE UNIQUE INDEX "IdempotencyRecord_userId_key_key"
    ON "IdempotencyRecord"("userId", "key");

-- Index supports retention sweeps (delete rows older than N days).
CREATE INDEX "IdempotencyRecord_createdAt_idx"
    ON "IdempotencyRecord"("createdAt");
