-- 题库改名：把后导入的 40 套句集（系列 Native English 2000）的显示名
-- 从「English Flow · NNNN–MMMM」改为「Native English 2000 · NNNN–MMMM」，与系列名一致。
--
-- 只改 ChunkSet.name 这一个文本列：source 键（englishflow:NNNN-MMMM）、series、
-- 已发布作业、句子、视频、中文回填全部不受影响（幂等键不变）。
-- 纯文本 UPDATE——无整表重建、无 DROP、无外键级联，零数据风险。
UPDATE "ChunkSet"
SET "name" = REPLACE("name", 'English Flow · ', 'Native English 2000 · ')
WHERE "source" LIKE 'englishflow:%' AND "name" LIKE 'English Flow · %';
