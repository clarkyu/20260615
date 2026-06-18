-- 多环节作业·学生端：提交改为「按环节」唯一——同一份作业的不同环节各自独立提交/批改。
-- 把 Submission 的唯一键从 (assignmentId, studentId, attempt) 换成
-- (assignmentId, phaseId, studentId, attempt)。第 1 段（0027）已给每条 Submission 回填
-- phaseId，单环节作业每条 phaseId 唯一，故新旧等价；多环节才真正区分。
--
-- 仅替换唯一索引——DROP INDEX + CREATE UNIQUE INDEX，无整表重建、无 DROP TABLE、无外键级联，零数据风险。
DROP INDEX "Submission_assignmentId_studentId_attempt_key";
CREATE UNIQUE INDEX "Submission_assignmentId_phaseId_studentId_attempt_key" ON "Submission"("assignmentId", "phaseId", "studentId", "attempt");
