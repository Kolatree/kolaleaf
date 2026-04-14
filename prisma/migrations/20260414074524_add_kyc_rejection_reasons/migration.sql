-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycRejectionReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
