-- 学期总评(成绩档案):三类别(课堂表现/训练/期末)加权总评。草稿分数一律由 lib/domain/review.ts
-- 纯函数读时现算、不落库;只有「发布」落一行不可变快照(版本+审计+学生可见性的唯一开关)。
-- 纯建表,零已有表改动。配置/改分/快照三表全部挂 CourseOffering(自带 学年+学期)。
CREATE TABLE "SemesterReviewConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offeringId" INTEGER NOT NULL,
    "configJson" TEXT NOT NULL,
    "aiAdviceJson" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SemesterReviewConfig_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SemesterReviewConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SemesterReviewConfig_offeringId_key" ON "SemesterReviewConfig"("offeringId");

-- 类别级老师改分:自动分永远读时重算,改分是独立行;删行=撤销回自动值。state=EXEMPT(免计,
-- 其余类别权重按比例重归一)时 score 为 null。总评(total)不允许 override,永远公式算。
CREATE TABLE "SemesterReviewOverride" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offeringId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "score" REAL,
    "state" TEXT NOT NULL DEFAULT 'OVERRIDE',
    "reason" TEXT,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SemesterReviewOverride_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SemesterReviewOverride_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SemesterReviewOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SemesterReviewOverride_offeringId_studentId_categoryKey_key" ON "SemesterReviewOverride"("offeringId", "studentId", "categoryKey");
CREATE INDEX "SemesterReviewOverride_studentId_idx" ON "SemesterReviewOverride"("studentId");

-- 发布快照:一版一行、不可变(冻结比例+每生 自动/改分/生效/总评+匿名分布)。学生可见 =
-- revokedAt IS NULL 的最大 version;撤回=标记(行保留审计);修订=发布新版本。
CREATE TABLE "SemesterReviewPublish" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offeringId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "configJson" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "note" TEXT,
    "publishedById" INTEGER,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedById" INTEGER,
    "revokedAt" DATETIME,
    CONSTRAINT "SemesterReviewPublish_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SemesterReviewPublish_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SemesterReviewPublish_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SemesterReviewPublish_offeringId_version_key" ON "SemesterReviewPublish"("offeringId", "version");
