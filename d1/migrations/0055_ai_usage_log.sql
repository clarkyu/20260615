-- AI 评阅成本流水账本(期末考核复盘):每次 AI 调用追加一行,真实 token 与成本永不覆盖。
-- 仪表盘与支出护栏都 SUM 本表(取代被覆盖/漏记的 Submission.costMicroUsd 单列)。
CREATE TABLE "AiUsageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER,
    "schoolId" INTEGER,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");
CREATE INDEX "AiUsageLog_schoolId_idx" ON "AiUsageLog"("schoolId");
