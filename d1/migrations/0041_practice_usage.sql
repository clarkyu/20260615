-- Real AI usage/cost per practice round (perception + judge), captured from provider
-- responses. Additive + nullable: existing rows stay NULL, no backfill needed.
ALTER TABLE "PracticeAttempt" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "PracticeAttempt" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "PracticeAttempt" ADD COLUMN "costUsd" REAL;
