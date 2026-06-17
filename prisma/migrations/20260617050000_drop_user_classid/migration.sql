-- 班级成员关系全部以 StudentClass 为唯一来源：删除历史列 User.classId（旧“主班级”）。
-- 自此一个学生的所有班级一律平等，仅存在于 StudentClass，可见性 = StudentClass 的并集。
--
-- 删除列前先把每个学生现有的 classId 回填成 StudentClass 成员关系（幂等），保证不丢可见性。
-- SQLite 不能直接删列（classId 上有外键 User_classId_fkey 与索引 User_classId_idx），需整表重建。
-- defer_foreign_keys 让引用 User 的子表（Submission / CourseOffering / StudentClass …）外键在
-- 事务提交时再校验——重建后表名与行 id 不变，引用仍然成立（与 0003 / 0022 同一手法）。

-- 1) 回填：把现有“主班级”写成 StudentClass 成员关系（已存在则忽略）。
INSERT OR IGNORE INTO "StudentClass" ("studentId", "classId")
SELECT "id", "classId" FROM "User" WHERE "role" = 'STUDENT' AND "classId" IS NOT NULL;

-- 2) 整表重建 User，去掉 classId 列及其外键/索引（其余列与约束逐字保持不变）。
PRAGMA defer_foreign_keys = ON;

CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "role" TEXT NOT NULL DEFAULT 'TEACHER',
    "email" TEXT,
    "emailVerified" DATETIME,
    "studentNo" TEXT,
    "schoolId" INTEGER,
    "department" TEXT,
    "major" TEXT,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "staffNo" TEXT,
    "phone" TEXT,
    "departmentId" INTEGER,
    "defaultPerceptionModel" TEXT,
    "defaultJudgeModel" TEXT,
    CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_User" ("id", "role", "email", "emailVerified", "studentNo", "schoolId", "department", "major", "name", "passwordHash", "isActive", "mustChangePassword", "createdAt", "updatedAt", "staffNo", "phone", "departmentId", "defaultPerceptionModel", "defaultJudgeModel")
SELECT "id", "role", "email", "emailVerified", "studentNo", "schoolId", "department", "major", "name", "passwordHash", "isActive", "mustChangePassword", "createdAt", "updatedAt", "staffNo", "phone", "departmentId", "defaultPerceptionModel", "defaultJudgeModel" FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_schoolId_idx" ON "User"("schoolId");
CREATE UNIQUE INDEX "User_schoolId_studentNo_key" ON "User"("schoolId", "studentNo");
CREATE UNIQUE INDEX "User_schoolId_staffNo_key" ON "User"("schoolId", "staffNo");
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

PRAGMA defer_foreign_keys = OFF;
