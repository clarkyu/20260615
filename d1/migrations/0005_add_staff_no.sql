-- Teacher / staff login number (工号).
ALTER TABLE "User" ADD COLUMN "staffNo" TEXT;
CREATE UNIQUE INDEX "User_schoolId_staffNo_key" ON "User"("schoolId", "staffNo");
