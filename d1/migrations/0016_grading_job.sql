-- 批改任务表：把提交后的自动批改从尽力而为升级为持久 + 有界重试 + 自愈。
-- 一份提交对应一条任务（submissionId 唯一）；后台 drain 认领并执行，失败按指数
-- 退避重排，超过上限进死信。教师面板加载时自愈重扫到期/卡住的任务。
CREATE TABLE "GradingJob" (
    "id"            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId"  INTEGER NOT NULL,
    "kind"          TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'PENDING',
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError"     TEXT,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL,
    CONSTRAINT "GradingJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GradingJob_submissionId_key" ON "GradingJob" ("submissionId");
CREATE INDEX "GradingJob_status_nextAttemptAt_idx" ON "GradingJob" ("status", "nextAttemptAt");
