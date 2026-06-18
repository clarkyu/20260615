-- 作业模板表：把一次作业发布的配置（标题 + 各环节，JSON）存起来，供本人下次或同校
-- 其他老师复用修改后再发布。纯增量：只 CREATE TABLE + CREATE INDEX，无表重建、无 DROP、
-- 无外键级联到现有数据，零数据风险。
-- CreateTable
CREATE TABLE "AssignmentTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolId" INTEGER,
    "name" TEXT NOT NULL,
    "createdById" INTEGER,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AssignmentTemplate_schoolId_idx" ON "AssignmentTemplate"("schoolId");
