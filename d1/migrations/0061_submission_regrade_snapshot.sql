-- 重评回退快照:regrade-phase 首次重置一行前存下当时完整评分态,restore-scores 据此一键还原到重评前。
-- 纯增量:仅可空 ADD COLUMN,零数据风险。
ALTER TABLE "Submission" ADD COLUMN "regradeSnapshot" TEXT;
