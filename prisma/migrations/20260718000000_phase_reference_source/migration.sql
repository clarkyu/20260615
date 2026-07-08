-- 评分个性化：① 下游口语环节按「本人前置写作环节文本」评分（referenceSource='prior-text'，约定 a）；
-- ② 背诵检测类环节合规 ±10（complianceScoring）。纯增量：仅可空 / 带默认的 ADD COLUMN，零数据风险。
ALTER TABLE "Phase" ADD COLUMN "referenceSource" TEXT;
ALTER TABLE "Phase" ADD COLUMN "complianceScoring" BOOLEAN NOT NULL DEFAULT false;
