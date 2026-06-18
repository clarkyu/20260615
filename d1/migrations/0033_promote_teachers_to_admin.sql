-- 把校管做成真角色的一次性回填：现有教职工（TEACHER）全部升为学校管理员（SCHOOL_ADMIN）。
-- 纯数据更新、幂等；此后新增的教师默认仍是 TEACHER（受限角色），由校管按需提升。
-- UpdateData
UPDATE "User" SET "role" = 'SCHOOL_ADMIN' WHERE "role" = 'TEACHER';
