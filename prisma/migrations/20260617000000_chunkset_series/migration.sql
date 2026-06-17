-- 题库句集加「系列」字段，把同一来源的多套归到一个系列（如 Native English 2000）。
-- 可空、纯增量列，对存量数据零影响。
ALTER TABLE "ChunkSet" ADD COLUMN "series" TEXT;
