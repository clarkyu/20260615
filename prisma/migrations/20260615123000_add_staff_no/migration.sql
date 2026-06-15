-- AlterTable
ALTER TABLE "User" ADD COLUMN "staffNo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_staffNo_key" ON "User"("schoolId", "staffNo");
