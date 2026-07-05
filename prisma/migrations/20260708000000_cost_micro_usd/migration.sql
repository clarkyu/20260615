-- 计费级精度：整数微美元(1 USD = 1_000_000 µUSD)。金额落 Float 在小额多行求和时会漂移，
-- 达不到账单精度——改存整数、按整数累加则精确。可空 ADD COLUMN + 从旧 REAL 列 costUsd
-- 回填历史行(四舍五入到最近 µUSD)，使新旧行都能在 costMicroUsd 上聚合。
ALTER TABLE "Submission" ADD COLUMN "costMicroUsd" INTEGER;
ALTER TABLE "PracticeAttempt" ADD COLUMN "costMicroUsd" INTEGER;
UPDATE "Submission" SET "costMicroUsd" = CAST(ROUND("costUsd" * 1000000) AS INTEGER) WHERE "costUsd" IS NOT NULL;
UPDATE "PracticeAttempt" SET "costMicroUsd" = CAST(ROUND("costUsd" * 1000000) AS INTEGER) WHERE "costUsd" IS NOT NULL;
