-- 给 SchoolInvite.createdById 建外键(此前是裸 Int，无引用完整性)。SQLite 不能对现有列追加
-- 外键或改可空，需整表重建。createdById 改可空 + ON DELETE SET NULL(与 AssignmentTemplate.createdBy
-- 同一策略):删除创建者时保留邀请、仅把创建者置空。重建时把指向已不存在用户的历史 createdById
-- 一并置空(自愈)，避免延迟外键校验在提交时失败——非破坏、不丢行。defer_foreign_keys 让外键校验
-- 推迟到事务提交(本表无子表，主要为一致性与与其它重建迁移风格一致)。
PRAGMA defer_foreign_keys = ON;

CREATE TABLE "new_SchoolInvite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tokenHash" TEXT NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchoolInvite_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SchoolInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_SchoolInvite" ("id", "tokenHash", "schoolId", "createdById", "expiresAt", "usedAt", "createdAt")
SELECT "id", "tokenHash", "schoolId",
    CASE WHEN "createdById" IN (SELECT "id" FROM "User") THEN "createdById" ELSE NULL END,
    "expiresAt", "usedAt", "createdAt"
FROM "SchoolInvite";

DROP TABLE "SchoolInvite";
ALTER TABLE "new_SchoolInvite" RENAME TO "SchoolInvite";

CREATE UNIQUE INDEX "SchoolInvite_tokenHash_key" ON "SchoolInvite"("tokenHash");
CREATE INDEX "SchoolInvite_schoolId_idx" ON "SchoolInvite"("schoolId");
CREATE INDEX "SchoolInvite_createdById_idx" ON "SchoolInvite"("createdById");
