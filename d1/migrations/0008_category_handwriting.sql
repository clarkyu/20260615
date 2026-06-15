-- Assignment category (背诵/口语/书面/试卷…，可定制) + handwriting submission + image key.
ALTER TABLE "Assignment" ADD COLUMN "category" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "requireHandwriting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Submission" ADD COLUMN "imageKey" TEXT;
