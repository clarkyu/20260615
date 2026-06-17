-- 多环节作业·地基（增量㉘ 第1段）。
-- 一份作业从"扁平的单一要求 + 单一时间窗"升级为"有序的多个环节"：新增 Phase（环节）表，
-- 把每份现有作业回填成一个 order=1 的环节（逐字拷贝其现有配置），并给 Sentence /
-- Submission / PracticeAttempt 增加可空 phaseId、回填指向该作业的那个环节。
--
-- 本段纯打地基：应用代码仍读 Assignment 自带的那套列，行为完全不变。
-- 纯增量——只有 CREATE TABLE / ADD COLUMN / UPDATE / CREATE INDEX：不重建表、不 DROP、
-- 无外键级联删除，零数据风险（与 0025 整表重建完全不同类）。

CREATE TABLE "Phase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assignmentId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "category" TEXT,
    "instructions" TEXT,
    "rubric" TEXT,
    "shadowVideoKey" TEXT,
    "chunkSetId" INTEGER,
    "referenceAudioKey" TEXT,
    "openAt" DATETIME,
    "dueAt" DATETIME,
    "requireEyesClosed" BOOLEAN NOT NULL DEFAULT true,
    "requireText" BOOLEAN NOT NULL DEFAULT true,
    "requireAudio" BOOLEAN NOT NULL DEFAULT false,
    "requireVideo" BOOLEAN NOT NULL DEFAULT true,
    "requireHandwriting" BOOLEAN NOT NULL DEFAULT false,
    "graded" BOOLEAN NOT NULL DEFAULT true,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "defaultPerceptionModel" TEXT,
    "defaultJudgeModel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Phase_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Phase_chunkSetId_fkey" FOREIGN KEY ("chunkSetId") REFERENCES "ChunkSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Phase_assignmentId_idx" ON "Phase"("assignmentId");
CREATE INDEX "Phase_chunkSetId_idx" ON "Phase"("chunkSetId");

-- 回填：每份作业 → 一个 order=1 的环节，逐字拷贝其现有配置（graded 一律 true）。
INSERT INTO "Phase" ("assignmentId", "order", "title", "category", "instructions", "rubric", "shadowVideoKey", "chunkSetId", "referenceAudioKey", "openAt", "dueAt", "requireEyesClosed", "requireText", "requireAudio", "requireVideo", "requireHandwriting", "graded", "maxAttempts", "defaultPerceptionModel", "defaultJudgeModel", "createdAt", "updatedAt")
SELECT "id", 1, "title", "category", "instructions", "rubric", "shadowVideoKey", "chunkSetId", "referenceAudioKey", "openAt", "dueAt", "requireEyesClosed", "requireText", "requireAudio", "requireVideo", "requireHandwriting", true, "maxAttempts", "defaultPerceptionModel", "defaultJudgeModel", "createdAt", "updatedAt"
FROM "Assignment";

-- 子表加可空 phaseId，并回填指向该作业的唯一环节。
ALTER TABLE "Sentence" ADD COLUMN "phaseId" INTEGER;
UPDATE "Sentence" SET "phaseId" = (SELECT "p"."id" FROM "Phase" "p" WHERE "p"."assignmentId" = "Sentence"."assignmentId");
CREATE INDEX "Sentence_phaseId_idx" ON "Sentence"("phaseId");

ALTER TABLE "Submission" ADD COLUMN "phaseId" INTEGER;
UPDATE "Submission" SET "phaseId" = (SELECT "p"."id" FROM "Phase" "p" WHERE "p"."assignmentId" = "Submission"."assignmentId");
CREATE INDEX "Submission_phaseId_idx" ON "Submission"("phaseId");

ALTER TABLE "PracticeAttempt" ADD COLUMN "phaseId" INTEGER;
UPDATE "PracticeAttempt" SET "phaseId" = (SELECT "p"."id" FROM "Phase" "p" WHERE "p"."assignmentId" = "PracticeAttempt"."assignmentId");
CREATE INDEX "PracticeAttempt_phaseId_idx" ON "PracticeAttempt"("phaseId");
