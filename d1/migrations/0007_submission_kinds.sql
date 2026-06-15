-- What students must submit: text (默写) / audio / video, any combination.
ALTER TABLE "Assignment" ADD COLUMN "requireText" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Assignment" ADD COLUMN "requireAudio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Assignment" ADD COLUMN "requireVideo" BOOLEAN NOT NULL DEFAULT true;
