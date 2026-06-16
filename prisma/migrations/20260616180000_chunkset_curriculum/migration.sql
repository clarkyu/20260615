-- 题库句集加课程元数据（级别/技能/领域/标签/来源），均可空。
ALTER TABLE "ChunkSet" ADD COLUMN "cefr"   TEXT;
ALTER TABLE "ChunkSet" ADD COLUMN "strand" TEXT;
ALTER TABLE "ChunkSet" ADD COLUMN "domain" TEXT;
ALTER TABLE "ChunkSet" ADD COLUMN "tags"   TEXT;
ALTER TABLE "ChunkSet" ADD COLUMN "source" TEXT;
