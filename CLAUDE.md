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
- 响应后台任务用 `runAfterResponse`(`lib/cf.ts` 的 `waitUntil`);耐用评阅走 `GradingJob` 队列。

## 当前已知状态

- **CSP** 收在 Report-Only:严格 nonce 策略因 workerd 剥 CSP 请求头无法 enforce,阻于上游
  **opennextjs/opennextjs-cloudflare#1302**。全部根因 + 修好后的一行翻转步骤:
  **`docs/CSP-NONCE-OPENNEXT.md`**。
- 其它文档:`docs/OPERATIONS.md`(运维)、`docs/VISION.md`、`docs/BACKLOG.md`。
