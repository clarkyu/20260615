-- 给环节加显式类型判别式 itemType（speech/writing/objective）。历史上环节类型从不是一个
-- 字段，而是每个路由点（提交 / 评分 / 投票判定）各自从 require* 布尔临时推断。此列把推断集中
-- 成一处并持久化。加列可空（D1 ADD COLUMN 要求），随后按现有布尔回填——回填规则与
-- src/lib/phase-item-type.ts 的 phaseItemType() 完全一致，评分与提交行为不变。
ALTER TABLE "Phase" ADD COLUMN "itemType" TEXT;

-- ① 仅单选 / 投票（requireChoice 且无任何其它提交部分）→ objective（客观自动判分或纯计票）
UPDATE "Phase" SET "itemType" = 'objective'
 WHERE "requireChoice" = 1
   AND "requireFreeText" = 0
   AND "requireText" = 0
   AND "requireAudio" = 0
   AND "requireVideo" = 0
   AND "requireHandwriting" = 0;

-- ② 其余带音 / 视频的 → speech（感知 + 评分 AI 流水线）
UPDATE "Phase" SET "itemType" = 'speech'
 WHERE "itemType" IS NULL
   AND ("requireVideo" = 1 OR "requireAudio" = 1);

-- ③ 剩下的（打字默写 / 手写 / 自由文本）→ writing（老师人工评，暂不走 AI）
UPDATE "Phase" SET "itemType" = 'writing'
 WHERE "itemType" IS NULL;
