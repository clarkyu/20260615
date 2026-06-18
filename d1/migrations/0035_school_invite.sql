-- 学校教师邀请表。纯增量：CREATE TABLE + INDEX，无表重建/DROP，零数据风险。
-- CreateTable
CREATE TABLE "SchoolInvite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tokenHash" TEXT NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchoolInvite_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvite_tokenHash_key" ON "SchoolInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SchoolInvite_schoolId_idx" ON "SchoolInvite"("schoolId");
