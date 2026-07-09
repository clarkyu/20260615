-- 评分标准与分值分离：rubricPoints = 各维度分值的 JSON（[{"name":"完整度","points":40},…]）。
-- 与 rubric（标准/评语要求，纯文字）分开存、分开编辑；评分时代码把两者拼成判分 prompt、满分取分值之和。
-- 纯增量：可空 ADD COLUMN，零数据风险（历史行 null = 沿用旧行为、满分默认 100）。
ALTER TABLE "Phase" ADD COLUMN "rubricPoints" TEXT;
