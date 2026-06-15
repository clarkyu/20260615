-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "category" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "requireHandwriting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Submission" ADD COLUMN "imageKey" TEXT;
