-- 作业乐观并发锁列。编辑作业时按此值栅栏(where version=期望值 → increment):表单加载带走
-- 当前值,保存时若已被他人改动(值不符)则整笔拒绝、不动任何环节,防并发编辑互相覆盖/误删提交。
-- 可加常量默认的 NOT NULL 列,存量行全为 0,纯增量、零数据风险。
ALTER TABLE "Assignment" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
