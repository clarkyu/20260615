-- 环节·填空题（增量）：blanksJson = {text, accept} —— text 是带 ____（≥3 下划线）挖空标记
-- 的题干，accept 是每个空的可接受答案数组。提交即客观判分、按空给分（答对空数/总空数×满分），
-- 不走 AI。纯增量 ADD COLUMN（布尔默认 false / TEXT 可空），现有环节完全不受影响。
ALTER TABLE "Phase" ADD COLUMN "fillBlank" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Phase" ADD COLUMN "blanksJson" TEXT;
