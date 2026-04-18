-- Step 31: NULL_STATE sentinel on TransferStatus.
-- Used ONLY as TransferEvent.fromStatus for the initial "nothing ->
-- CREATED" audit row on transfer insert. No Transfer.status ever
-- occupies this value, so no backfill is required.
-- Postgres enum values must be added via ALTER TYPE ... ADD VALUE.
ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'NULL_STATE' BEFORE 'CREATED';
