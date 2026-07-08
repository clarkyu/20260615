-- 选题模式：把历史「投票 hack」升格为一等公民（P1）。可空加列，历史行取 NULL = 非选题标注、
-- 按纯投票处理，与今天行为逐字一致；仅当 requireChoice 且无答案键时有语义（poll/theme/branch）。
-- 幂等安全的向前兼容改动，不触碰任何既有列/数据。
ALTER TABLE "Phase" ADD COLUMN "selectionMode" TEXT;
