-- Real AI usage/cost per grade (perception + judge), captured from provider responses.
-- Additive + nullable: existing rows stay NULL, no backfill needed.
ALTER TABLE "Submission" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "Submission" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "Submission" ADD COLUMN "costUsd" REAL;
