-- Step 25: Soft-delete marker on User (Option B).
-- AuthEvent FK is Restrict + AUSTRAC 7-year retention, so we never
-- hard-delete User rows. A timestamp in deletedAt archives the row
-- and it drops out of the default Prisma query filter.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
