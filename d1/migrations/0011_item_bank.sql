-- 题库：句集(ChunkSet) + 双语句子(Chunk)；作业/句子加跟读视频与中文译文。
CREATE TABLE "ChunkSet" (
  "id"             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "schoolId"       INTEGER NOT NULL,
  "name"           TEXT NOT NULL,
  "shadowVideoKey" TEXT,
  "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChunkSet_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChunkSet_schoolId_idx" ON "ChunkSet" ("schoolId");

CREATE TABLE "Chunk" (
  "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "chunkSetId" INTEGER NOT NULL,
  "order"      INTEGER NOT NULL,
  "english"    TEXT NOT NULL,
  "chinese"    TEXT,
  CONSTRAINT "Chunk_chunkSetId_fkey" FOREIGN KEY ("chunkSetId") REFERENCES "ChunkSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Chunk_chunkSetId_idx" ON "Chunk" ("chunkSetId");

ALTER TABLE "Sentence" ADD COLUMN "translation" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "shadowVideoKey" TEXT;
