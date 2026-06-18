-- 环节·正式测试（强防作弊分层）标记。纯增量：仅 ADD COLUMN（布尔，默认 false），零数据风险。
-- AlterTable
ALTER TABLE "Phase" ADD COLUMN "isFormalTest" BOOLEAN NOT NULL DEFAULT false;
