-- Denormalize the owning offering onto Submission so per-offering reads (insights,
-- gradebook, per-offering score pairs) become a single indexed scan instead of a
-- Submission → Assignment → CourseOffering join. Additive + nullable (SQLite ADD COLUMN
-- can't be NOT NULL without a default). The backfill sets every existing row from its
-- assignment's offeringId; an assignment's offering never changes, and a deleted
-- assignment cascades its submissions away, so no row can keep a NULL. New rows are
-- written with offeringId by the app. No FK — integrity is transitive via the assignment.
ALTER TABLE "Submission" ADD COLUMN "offeringId" INTEGER;
UPDATE "Submission" SET "offeringId" = (SELECT "a"."offeringId" FROM "Assignment" "a" WHERE "a"."id" = "Submission"."assignmentId");
CREATE INDEX "Submission_offeringId_status_idx" ON "Submission"("offeringId", "status");
