-- 课堂表现(雨课堂导入):每次导入一行台账(节次元数据+权重+对账计数)+ 每生一行原始信号。
-- 分数不落库:detailJson 只存逐节原始信号(到课/弹幕/投稿/答题),课堂表现分由 lib/domain 纯函数
-- 读时按 weightsJson(老师可调)+保底/追溯宽松/剔除重开节 口径现算——方案与公平性护栏见
-- docs/SESSION-2026-07-09-RECOVERY.md §3。重复导入=新增一行台账(学期总评配置钉住 importId 不漂移)。
CREATE TABLE "ClassPerfImport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offeringId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "sessionsJson" TEXT NOT NULL,
    "weightsJson" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "importedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassPerfImport_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassPerfImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ClassPerfImport_offeringId_idx" ON "ClassPerfImport"("offeringId");

-- 每生一行:studentNo 匹配花名册(重复学号已合并:签到 OR、计数 SUM);userId 匹配到的应用内
-- 学生(可空:未匹配学号仅预览警示不建号);summaryJson 存汇总列快照(权威考勤数等)供对账。
CREATE TABLE "ClassPerfStudent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "importId" INTEGER NOT NULL,
    "studentNo" TEXT NOT NULL,
    "userId" INTEGER,
    "name" TEXT,
    "summaryJson" TEXT NOT NULL,
    "detailJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassPerfStudent_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ClassPerfImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassPerfStudent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClassPerfStudent_importId_studentNo_key" ON "ClassPerfStudent"("importId", "studentNo");
CREATE INDEX "ClassPerfStudent_userId_idx" ON "ClassPerfStudent"("userId");
