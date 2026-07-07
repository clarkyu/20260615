-- 缓存感知结果:感知(视频)成本约为判分的 16 倍。感知成功但整份评阅后段失败(如判分账户
-- 欠费 402)时,存下感知结果,耐久队列重试就能复用、跳过昂贵的重新感知(不再重烧 Gemini)。
-- 定稿(GRADED/FLAGGED)后清空(aiResult 已含完整结果)。可空加列,幂等重跑安全。
ALTER TABLE "Submission" ADD COLUMN "perceptionJson" TEXT;
