-- 限流计数表：让限流跨 isolate 共享（内存版每个 isolate 各算各的，形同虚设）。
CREATE TABLE "RateLimit" (
    "key"     TEXT NOT NULL PRIMARY KEY,
    "count"   INTEGER NOT NULL DEFAULT 0,
    "resetAt" DATETIME NOT NULL
);
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit" ("resetAt");
