-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;
