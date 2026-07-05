-- Index Feedback.schoolId: admin "feedback by school" filters were a full table scan
-- (schoolId is a denormalized scoping tag with no FK/index). Additive CREATE INDEX.
CREATE INDEX "Feedback_schoolId_idx" ON "Feedback"("schoolId");
