-- DropForeignKey
ALTER TABLE "Recipient" DROP CONSTRAINT "Recipient_userId_fkey";

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
