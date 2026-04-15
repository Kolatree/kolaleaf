/*
  Warnings:

  - You are about to drop the column `backupCodes` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `totpEnabled` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `totpSecret` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "backupCodes",
DROP COLUMN "totpEnabled",
DROP COLUMN "totpSecret";
