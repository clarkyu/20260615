-- 作业性质 mode(VISION 的「四态」:作业/训练/测评/考试),批次卡的分类标签改由它驱动。
-- 存机器值 HOMEWORK/TRAINING/ASSESSMENT/EXAM,显示走 i18n。可空:老作业未定性质。
ALTER TABLE "Assignment" ADD COLUMN "mode" TEXT;
