-- 作业引用题库句集（用于学生端三段式跟读呈现）。
ALTER TABLE "Assignment" ADD COLUMN "chunkSetId" INTEGER REFERENCES "ChunkSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Assignment_chunkSetId_idx" ON "Assignment" ("chunkSetId");
