# CLAUDE.md

Guidance for Claude working in this repo. Keep it short; deep detail lives in `docs/` and
`.claude/skills/`.

## 你好！作业 / Hi-Homework

手机端背诵作业 PWA(面向 minors):录制提交 → AI 评阅 → 按班级统计导出。i18n 中/英/西。

## 工作流 / PR 约定（重要）

- **PR 由维护者(clark)合并。Claude 只给可点击链接 + 一句话改动说明,绝不自己 merge**
  (不走 API/CLI 自合)。等 clark 合并后再继续下一步。
- 功能开发走 off-`main` 的话题分支 → **draft PR** → 给链接。CI 绿 + clark review 后由他合。
- push 到 `main` 触发 `deploy.yml` 自动部署(D1 migrate → cf:deploy)。
- 只在 clark 明确要求时才 commit/push。绝不 force-push `main`。

## 技术栈

Next.js App Router + **OpenNext on Cloudflare Workers** + **D1**(SQLite) + **R2**;iron-session;
**Prisma 7**;Tailwind。生产运行时是 workerd(不是 Node)——注意 Node API 不一定可用。

## 服务端分层(严格)

`app/`(页面 Server Component,只读聚合查询)→ `actions/`(薄:auth→校验→委派→revalidate)→
`lib/domain/`(业务编排,无 auth/i18n/Next)→ `lib/repo/`(**唯一**正常写 prisma 的地方 + 多租户
scoping)→ prisma。依赖只能向下。

- 多租户边界在 `lib/repo`:每个查询按 `schoolId ?? -1` sentinel(或 `offering.schoolId`)scope。
- **lint 强制**:`actions/**` 不许 import `@/lib/db`/`@prisma/client` 或直接调 `prisma.x`
  (仅 `actions/auth.ts` 豁免)。
- 详见 **`docs/ARCHITECTURE.md`** 与 skill **`.claude/skills/system-architecture`**(碰服务端代码必读)。

## 硬约定(CI 会拦)

- **双迁移树**:`d1/migrations/NNNN_name.sql` ↔ `prisma/migrations/<ts>_name/migration.sql`,
  按**逻辑名 1:1 配对**(`src/lib/__tests__/migrations.test.ts` 强制)。加列用可空
  `ALTER TABLE ADD COLUMN`。改 schema 后记得 `npx prisma generate`。
- **整表重建须幂等**:凡 `CREATE TABLE "new_X"` 的重建迁移,必须以 `DROP TABLE IF EXISTS "new_X"`
  开头(同一 `migrations.test.ts` 强制),这样中途失败重跑不会撞「表已存在」。**已应用的迁移一律
  不可改、不可手动重跑**(prod 靠 `d1_migrations` 记账;改动已应用的 prisma 迁移还会触发 checksum)。
- **i18n 平价**:`src/lib/i18n.ts` 里 `zh`/`en`/`es` 三本字典键必须全等
  (`src/lib/__tests__/i18n.test.ts` 强制)。
- **env 只走 `lib/config.ts`**:别处不许 `process.env.X`。**日志只记密钥有无、绝不记值**。

## 命令

- `npm run lint`(`eslint src`) · `npx tsc --noEmit` · `npm test`(`vitest run`)
- `npx opennextjs-cloudflare build`(CI 会跑这个真 workers 构建,不只是 `next build`)
- 部署由 `deploy.yml` 做;别本地手动 deploy。

## Cloudflare/D1 注意

- D1 无交互式事务;嵌套 autoincrement `create` 会失败——用独立 create。`createMany` /
  `$transaction([deleteMany, createMany])` 可以。
- 响应后台任务用 `runAfterResponse`(`lib/cf.ts` 的 `waitUntil`)——**注意:响应后 ~30 秒
  就会被终止,长活(评阅)绝不能靠它**;耐用评阅走 `GradingJob` 队列 + 同步 drain。

## 当前已知状态

- **CSP**:响应侧突围已落地——自定义入口 `worker.ts` 用 HTMLRewriter 给所有 script/preload
  注入 nonce(不再依赖被 workerd 剥掉的请求头)。阶段一(补 nonce + 仍 Report-Only)已上线;
  阶段二翻转 = `wrangler.jsonc` 的 `CSP_ENFORCE` 改 `"enforce"` 一行。全案:
  **`docs/CSP-NONCE-OPENNEXT.md`**(上游 #1302 仍未修,但已不挡路)。
- **期末考核 AI 评阅**:2026-07-07 会话的复盘/修复/清积压全记录 + 恢复指引:
  **`docs/GRADING-BACKLOG-2026-07.md`**(存档时队列还在排空,收官待办见该文 §五)。
  运维一律走 Actions 按钮(`admin-call.yml` / `grading-queue-drain` / `d1-query`),见
  `docs/OPERATIONS.md` §6。
- **评分个性化 · 标准/分值分离**(2026-07-09 收官):`Phase.rubricPoints` 存各维度分值
  JSON,与 `rubric` 标准文字**分开存/分开编辑**;评分时 `lib/domain/rubric.ts` 的
  `composeRubric` 拼判分 prompt、**满分取各分值之和**(代码求和,不靠 LLM 算术)。老师两个入口
  都能分开设 + 一键 AI 批阅:评分页每环节配置面板(#430)、作业创建/编辑表单(#431);后端 #429。
  三批(期末 + Native English 五月/六月)已全采用 AI、`needsReview=0`。整条线复盘 + PR 台账
  (#420–#431)见 **`docs/GRADING-BACKLOG-2026-07.md` §九**。
- 其它文档:`docs/OPERATIONS.md`(运维)、`docs/VISION.md`、`docs/BACKLOG.md`、
  审计台账 `docs/CODE-AUDIT-2026-07*.md`。
