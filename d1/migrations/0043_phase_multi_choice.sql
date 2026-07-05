-- 环节·多选题（增量）：单选之外再支持多选。multiChoice=true → 学生可多选；correctChoices
-- 是正确选项文本的 JSON 数组（设了则提交即客观判分：所选集合 == 正确集合 → 满分，否则 0；
-- 为空 → 多选投票，仅统计分布）。纯增量 ADD COLUMN（布尔默认 false / TEXT 可空），现有
-- 单选/投票及其它环节完全不受影响。
ALTER TABLE "Phase" ADD COLUMN "multiChoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Phase" ADD COLUMN "correctChoices" TEXT;
