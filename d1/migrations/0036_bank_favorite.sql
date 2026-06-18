-- 老师收藏题库套题表。纯增量：CREATE TABLE + INDEX，无表重建/DROP，零数据风险。
-- CreateTable
CREATE TABLE "BankFavorite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "chunkSetId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BankFavorite_chunkSetId_fkey" FOREIGN KEY ("chunkSetId") REFERENCES "ChunkSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BankFavorite_userId_idx" ON "BankFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BankFavorite_userId_chunkSetId_key" ON "BankFavorite"("userId", "chunkSetId");
