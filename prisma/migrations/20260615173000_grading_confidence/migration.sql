-- AlterTable
ALTER TABLE "Submission" ADD COLUMN "confidence" REAL;
ALTER TABLE "Submission" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
