-- Practice attempts: unlimited pre-submission "practice" rounds with instant AI
-- feedback. Separate from Submission so practice never consumes a graded attempt.
CREATE TABLE "PracticeAttempt" (
  "id"           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "assignmentId" INTEGER NOT NULL,
  "studentId"    INTEGER NOT NULL,
  "kind"         TEXT NOT NULL,
  "mediaKey"     TEXT,
  "recitedText"  TEXT,
  "aiScore"      REAL,
  "confidence"   REAL,
  "feedback"     TEXT,
  "feedbackJson" TEXT,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PracticeAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticeAttempt_assignmentId_studentId_idx" ON "PracticeAttempt" ("assignmentId", "studentId");
CREATE INDEX "PracticeAttempt_studentId_idx" ON "PracticeAttempt" ("studentId");
