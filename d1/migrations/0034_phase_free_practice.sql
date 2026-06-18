-- 环节·自由练习标记（仅练习不计分时，老师可勾选「不限次数、不进待批」）。
-- 纯增量：仅 ADD COLUMN（布尔，默认 false），零数据风险。
-- AlterTable
ALTER TABLE "Phase" ADD COLUMN "freePractice" BOOLEAN NOT NULL DEFAULT false;
