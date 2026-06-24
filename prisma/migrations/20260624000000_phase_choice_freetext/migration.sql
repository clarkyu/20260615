-- 环节·新增提交类型：单选投票（无正确答案，仅统计分布）+ 自由文本（开放式，老师评阅时人工打分）。
-- 纯增量：仅 ADD COLUMN（布尔默认 false / TEXT 可空），零数据风险，现有背诵环节完全不受影响。
-- AlterTable
ALTER TABLE "Phase" ADD COLUMN "requireChoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Phase" ADD COLUMN "choicesJson" TEXT;
ALTER TABLE "Phase" ADD COLUMN "requireFreeText" BOOLEAN NOT NULL DEFAULT false;
