-- 逐句跟读录音：跟读作业里学生为每个句子单独录一条音频。
CREATE TABLE "ShadowTake" (
  "id"           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "submissionId" INTEGER NOT NULL,
  "order"        INTEGER NOT NULL,
  "audioKey"     TEXT NOT NULL,
  "durationSec"  INTEGER,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShadowTake_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ShadowTake_submissionId_order_key" ON "ShadowTake" ("submissionId", "order");
CREATE INDEX "ShadowTake_submissionId_idx" ON "ShadowTake" ("submissionId");
