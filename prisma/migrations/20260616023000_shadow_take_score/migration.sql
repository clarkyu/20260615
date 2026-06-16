-- 逐句 AI 评分：每条 take 的得分与识别文本。
ALTER TABLE "ShadowTake" ADD COLUMN "aiScore" REAL;
ALTER TABLE "ShadowTake" ADD COLUMN "spokenText" TEXT;
