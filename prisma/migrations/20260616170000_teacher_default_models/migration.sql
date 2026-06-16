-- 每位老师自己的默认批改模型（null → 平台默认）。
ALTER TABLE "User" ADD COLUMN "defaultPerceptionModel" TEXT;
ALTER TABLE "User" ADD COLUMN "defaultJudgeModel" TEXT;
