-- 学生「看过成绩」时间戳。纯增量：仅 ADD COLUMN（可空，无默认），零数据风险。
-- AlterTable
ALTER TABLE "User" ADD COLUMN "scoresSeenAt" DATETIME;
