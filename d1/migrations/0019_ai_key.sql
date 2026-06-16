-- 老师自带密钥（BYOK）：各家 API key 加密后按 (userId, provider) 存放。
CREATE TABLE "AiKey" (
    "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId"     INTEGER NOT NULL,
    "provider"   TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv"         TEXT NOT NULL,
    "last4"      TEXT NOT NULL,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  DATETIME NOT NULL,
    CONSTRAINT "AiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "AiKey_userId_provider_key" ON "AiKey" ("userId", "provider");
