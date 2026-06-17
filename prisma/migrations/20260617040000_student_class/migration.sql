-- 学生可同时属于多个班级：在主班级（User.classId）之外，额外班级记录在 StudentClass。
-- 可见性 = 主班级 ∪ 额外成员关系。纯新增表，不动存量数据。
CREATE TABLE "StudentClass" (
  "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "studentId" INTEGER NOT NULL,
  "classId"   INTEGER NOT NULL,
  CONSTRAINT "StudentClass_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudentClass_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudentClass_studentId_classId_key" ON "StudentClass" ("studentId", "classId");
CREATE INDEX "StudentClass_classId_idx" ON "StudentClass" ("classId");
CREATE INDEX "StudentClass_studentId_idx" ON "StudentClass" ("studentId");
