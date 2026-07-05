-- 发布批次(增量):一次"发一份作业 + 勾多个班"给每个班各建一份,共享同一 batchId,
-- 使"发布后改一次评分标准 → 同步到同批次其它班级"能按 batchId 找到兄弟作业。纯增量
-- ADD COLUMN(TEXT 可空),老作业为 null、不参与批量同步,现有行为完全不受影响。
ALTER TABLE "Assignment" ADD COLUMN "batchId" TEXT;
