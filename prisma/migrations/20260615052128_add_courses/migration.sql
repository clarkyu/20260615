/*
  Warnings:

  - You are about to drop the `AssignmentClass` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `createdById` on the `Assignment` table. All the data in the column will be lost.
  - You are about to drop the column `schoolId` on the `Assignment` table. All the data in the column will be lost.
  - Added the required column `offeringId` to the `Assignment` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AssignmentClass_classId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AssignmentClass";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Course" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Course_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseOffering" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "year" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseOffering_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseOffering_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseOffering_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseOffering_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Assignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "offeringId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "monthLabel" TEXT,
    "instructions" TEXT,
    "rubric" TEXT,
    "referenceAudioKey" TEXT,
    "openAt" DATETIME,
    "dueAt" DATETIME,
    "requireEyesClosed" BOOLEAN NOT NULL DEFAULT true,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "defaultPerceptionModel" TEXT,
    "defaultJudgeModel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Assignment" ("createdAt", "defaultJudgeModel", "defaultPerceptionModel", "dueAt", "id", "instructions", "maxAttempts", "monthLabel", "openAt", "referenceAudioKey", "requireEyesClosed", "rubric", "title", "updatedAt") SELECT "createdAt", "defaultJudgeModel", "defaultPerceptionModel", "dueAt", "id", "instructions", "maxAttempts", "monthLabel", "openAt", "referenceAudioKey", "requireEyesClosed", "rubric", "title", "updatedAt" FROM "Assignment";
DROP TABLE "Assignment";
ALTER TABLE "new_Assignment" RENAME TO "Assignment";
CREATE INDEX "Assignment_offeringId_idx" ON "Assignment"("offeringId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Course_schoolId_idx" ON "Course"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_schoolId_code_key" ON "Course"("schoolId", "code");

-- CreateIndex
CREATE INDEX "CourseOffering_schoolId_idx" ON "CourseOffering"("schoolId");

-- CreateIndex
CREATE INDEX "CourseOffering_teacherId_idx" ON "CourseOffering"("teacherId");

-- CreateIndex
CREATE INDEX "CourseOffering_classId_idx" ON "CourseOffering"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseOffering_courseId_classId_year_semester_key" ON "CourseOffering"("courseId", "classId", "year", "semester");
