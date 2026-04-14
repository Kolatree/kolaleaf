-- DropForeignKey
ALTER TABLE "AuthEvent" DROP CONSTRAINT "AuthEvent_userId_fkey";

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
