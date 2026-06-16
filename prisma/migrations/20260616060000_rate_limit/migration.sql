-- 限流计数表：让限流跨 isolate 共享。
CREATE TABLE "RateLimit" (
    "key"     TEXT NOT NULL PRIMARY KEY,
    "count"   INTEGER NOT NULL DEFAULT 0,
    "resetAt" DATETIME NOT NULL
);
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit" ("resetAt");
