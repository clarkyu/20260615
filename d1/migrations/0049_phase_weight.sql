-- Per-phase weight toward the multi-phase assignment total (老师发布时可自定义)。
-- 总分 = Σ(环节分 × 权重) / Σ权重。NOT NULL DEFAULT 1 → 存量行全为 1 = 等权（与历史一致）。
ALTER TABLE "Phase" ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 1;
