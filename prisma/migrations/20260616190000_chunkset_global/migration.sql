-- 让 ChunkSet.schoolId 可空：null = 平台官方全局题库（所有学校可见、可发布，
-- 仅 SUPER_ADMIN 可编辑）。SQLite 不能直接把列由 NOT NULL 改为可空，需整表重建。
-- defer_foreign_keys 让子表（Chunk / Assignment）的外键在事务提交时再校验——
-- 重建后表名与行 id 不变，引用仍然成立。
PRAGMA defer_foreign_keys = ON;

CREATE TABLE "new_ChunkSet" (
  "id"             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "schoolId"       INTEGER,
  "name"           TEXT NOT NULL,
  "shadowVideoKey" TEXT,
  "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cefr"           TEXT,
  "strand"         TEXT,
  "domain"         TEXT,
  "tags"           TEXT,
  "source"         TEXT,
  CONSTRAINT "ChunkSet_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ChunkSet" ("id", "schoolId", "name", "shadowVideoKey", "createdAt", "cefr", "strand", "domain", "tags", "source")
SELECT "id", "schoolId", "name", "shadowVideoKey", "createdAt", "cefr", "strand", "domain", "tags", "source" FROM "ChunkSet";

DROP TABLE "ChunkSet";
ALTER TABLE "new_ChunkSet" RENAME TO "ChunkSet";
CREATE INDEX "ChunkSet_schoolId_idx" ON "ChunkSet" ("schoolId");
