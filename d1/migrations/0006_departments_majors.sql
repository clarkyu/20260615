-- Normalise 院系/专业 into Department + Major, link classes to a major, and add
-- phone + teacher department to users. Old string columns are left in place
-- (the app stops using them) so this migration only adds + backfills.

-- 1) New tables
CREATE TABLE "Department" (
    "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolId"  INTEGER NOT NULL,
    "name"      TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Department_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Department_schoolId_name_key" ON "Department"("schoolId", "name");
CREATE INDEX "Department_schoolId_idx" ON "Department"("schoolId");

CREATE TABLE "Major" (
    "id"           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolId"     INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "name"         TEXT NOT NULL,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Major_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Major_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Major_schoolId_name_key" ON "Major"("schoolId", "name");
CREATE INDEX "Major_schoolId_idx" ON "Major"("schoolId");
CREATE INDEX "Major_departmentId_idx" ON "Major"("departmentId");

-- 2) New columns (old "department"/"major" strings are kept as vestigial)
ALTER TABLE "ClassGroup" ADD COLUMN "majorId" INTEGER;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "departmentId" INTEGER;

-- 3) Backfill departments + majors from existing class strings
INSERT OR IGNORE INTO "Department" ("schoolId", "name")
  SELECT DISTINCT "schoolId", "department" FROM "ClassGroup"
  WHERE "department" IS NOT NULL AND "department" <> '';

INSERT OR IGNORE INTO "Major" ("schoolId", "departmentId", "name")
  SELECT DISTINCT c."schoolId", d."id", c."major"
  FROM "ClassGroup" c
  JOIN "Department" d ON d."schoolId" = c."schoolId" AND d."name" = c."department"
  WHERE c."major" IS NOT NULL AND c."major" <> '';

-- 4) Link each class to its major
UPDATE "ClassGroup" SET "majorId" = (
  SELECT m."id" FROM "Major" m
  JOIN "Department" d ON d."id" = m."departmentId"
  WHERE m."schoolId" = "ClassGroup"."schoolId"
    AND m."name" = "ClassGroup"."major"
    AND d."name" = "ClassGroup"."department"
  LIMIT 1
) WHERE "major" IS NOT NULL AND "major" <> '';

CREATE INDEX "ClassGroup_majorId_idx" ON "ClassGroup"("majorId");
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
