-- 让「专业」可以不挂「院系」：Major.departmentId 由 NOT NULL 放宽为可空。
-- 很多职校/教学班名单只有专业、没有独立院系（如行政班「专科2025司法信息技术2531320区队」，
-- 能抽出专业「司法信息技术」却无院系）。原先「专业必须挂院系」会导致这类专业建不出来、
-- 班级关联不上、专业/院系全空。
-- SQLite 不能直接改列可空性，需整表重建；defer_foreign_keys 让 ClassGroup.majorId 等引用在
-- 提交时再校验（表名与行 id 不变，引用仍成立，与 0003/0022/0025 同一手法）。零数据丢失。
PRAGMA defer_foreign_keys = ON;

CREATE TABLE "new_Major" (
    "id"           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolId"     INTEGER NOT NULL,
    "departmentId" INTEGER,
    "name"         TEXT NOT NULL,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Major_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Major_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Major" ("id", "schoolId", "departmentId", "name", "createdAt")
SELECT "id", "schoolId", "departmentId", "name", "createdAt" FROM "Major";

DROP TABLE "Major";
ALTER TABLE "new_Major" RENAME TO "Major";

CREATE UNIQUE INDEX "Major_schoolId_name_key" ON "Major"("schoolId", "name");
CREATE INDEX "Major_schoolId_idx" ON "Major"("schoolId");
CREATE INDEX "Major_departmentId_idx" ON "Major"("departmentId");

PRAGMA defer_foreign_keys = OFF;
