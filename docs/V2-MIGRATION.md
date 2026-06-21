# V2 迁移蓝图 / V2 Migration Blueprint

> **目标**：在一个**用本仓库作模板**新建的 v2 仓库里，把数据层从 **D1（SQLite）迁到
> Postgres + pgvector**、计算从 **Cloudflare Workers/OpenNext** 迁到**区域型平台
> （Fly.io / Cloud Run）的原生 Next.js**，保留 **R2** 存媒体，并在新地基上建**知识库
> （RAG/向量）+ 知识图谱**。v1（现仓库）继续给学生服务、**全程不动**，v2 跑通 + 数据
> 迁好 + 切换后再退役 v1。
>
> 本文件写在 v1 仓库里，作为 v2 开工的施工图。建好 v2 仓库后照此逐阶段推进。

---

## 0. 为什么是「模板新仓库」而不是分支或重写

- **不是重写**：`Use this template` 原样复制全部 working 代码（UI / actions / domain /
  i18n 三语 / 组件 / 347 测试），**一行不丢**。该换的只是数据层 + 运行时耦合那薄薄一层。
- **不是乱 fork**：模板生成**独立仓库、干净 history**，无 fork 纠缠。
- **大改用模板、小改用分支**：本次是「换库 + 换计算 + 甩 OpenNext + 上 KB/KG」的 **v2 大改**，
  分支会与 main 巨幅分叉、还共用不该共用的部署管线 → 模板新仓库更合适。

**建仓库**：v1 仓库 Settings → 勾 *Template repository* → 主页 *Use this template* →
*Create a new repository*（不勾 Include all branches）。**Secrets / Actions secrets /
branch protection / Claude Code on web 环境**都不随模板复制，需在 v2 重设。

---

## 1. 保留 vs 改动（约 85–90% 原样保留）

| 模块 | 改动？ | 说明 |
|---|---|---|
| `app/**`、`components/**` | ❌ 保留 | UI/页面与数据库无关 |
| `actions/**`、`lib/domain/**` | ❌ 基本保留 | 业务逻辑层；个别 raw SQL 见下 |
| `lib/i18n.ts`（zh/en/es 770×3） | ❌ 保留 | |
| `lib/auth`、`lib/session`（iron-session） | ❌ 保留 | 会话与平台无关 |
| **`lib/storage.ts`（R2）** | ❌ **保留** | 已用 **aws4fetch + `R2_*` 凭据**（非 Workers binding）→ 天生可移植，仅需在 v2 设 `R2_*` env |
| `prisma/schema.prisma` | ✅ provider | `sqlite` → `postgresql`；`Role`/`SubmissionStatus` 等 Prisma enum → 自动变 PG 原生 enum |
| `d1/migrations/**`（37 个） | ✅ 重生成 | SQLite DDL 不通用；用 `prisma migrate` 生成 Postgres 迁移 |
| `lib/db.ts` | ✅ 连接 | `getCloudflareContext` + `PrismaD1(env.DB)` → Postgres 连接（见阶段 1） |
| `lib/config.ts` | ✅ env | 加 `DATABASE_URL`；去掉 D1 相关 |
| `lib/cf.ts`（`runAfterResponse`=Workers `waitUntil`） | ✅ 替换 | → Next.js `after()` 或后台 worker 进程（见阶段 1） |
| `lib/repo/**` 查询 | ⚠️ 多数保留 | Prisma 查询大多通用；**逐字 raw SQL 要核方言**（`acceptAiForAssignment` 的 COALESCE 等） |
| `src/lib/__tests__/integration/harness.ts` | ✅ 引擎 | `better-sqlite3` → Postgres（见阶段 0） |
| `wrangler.jsonc`、`open-next.config.ts` | ✅ 删除 | 不再用 Cloudflare 运行时 |
| `next.config.mjs` | ✅ 精简 | 去 `initOpenNextCloudflareForDev`；**保留 securityHeaders** |
| `.github/workflows/deploy.yml` | ✅ 重写 | wrangler 部署 → Fly/Cloud Run 部署 |
| `package.json` | ✅ 依赖 | 去 `@opennextjs/cloudflare`/`wrangler`/`@prisma/adapter-d1`/`@cloudflare/workers-types`；加 Postgres 驱动（`@prisma/adapter-pg` 或 Neon driver）、Dockerfile/部署工具 |

---

## 2. 阶段清单

每阶段：**目标 → 改动 → 验证 → 完成标准 → 风险**。阶段 0–1 与「计算搬到哪」无关，先做。

### 阶段 0 · 库迁 Postgres + 测试全绿（**零部署、零生产影响**）
- **目标**：证明 schema 与每条 repo 查询在 Postgres 上都成立。
- **改动**：`schema.prisma` provider→postgresql；`prisma migrate dev` 生成首版 PG 迁移；
  集成 harness 改用 Postgres（本地 docker postgres / testcontainers / 嵌入式 PG）；
  核 raw SQL 方言（`acceptAiForAssignment` 等）；`lib/db.ts` 暂用本地连接串。
- **验证**：`npx tsc` / `lint` / **`vitest run` 全绿（347+）**，集成测试在 Postgres 上跑过
  IDOR scope / 真级联 / 批改围栏 / 名单导入。
- **完成标准**：整套测试在 Postgres 上绿；CI 通过。
- **风险**：SQLite↔PG 类型/方言差异（enum、DateTime、autoincrement→identity、COALESCE）。

### 阶段 1 · 去 Cloudflare 运行时耦合
- **目标**：把代码里对 Workers 运行时的依赖拆干净，改成普通 Node。
- **改动**：
  - `lib/db.ts`：去 `getCloudflareContext`/`PrismaD1` → Postgres 连接池（Fly/Cloud Run
    本地连接，无需 Hyperdrive）。
  - `lib/cf.ts`：`runAfterResponse` 的 `ctx.waitUntil` → **Next.js `after()`** 或交给后台
    drain 进程；保持「批改异步、durable queue」语义不变（队列表逻辑通用）。
  - `lib/storage.ts`：**不改逻辑**，仅确认 `R2_*` env 注入。
  - 删 `wrangler.jsonc` / `open-next.config.ts`；`next.config.mjs` 去 OpenNext、留 headers。
  - `package.json` 换依赖。
- **验证**：本地 `next dev` + `next build`（原生）通过；测试仍绿。
- **完成标准**：本地能原生跑起来、连本地 Postgres、读写 R2。
- **风险**：`after()` / 后台任务的执行语义与 `waitUntil` 略不同，需测异步批改链路。

### 阶段 2 · 计算平台（Fly.io / Cloud Run）
- **目标**：可部署的 v2 服务。
- **改动**：`Dockerfile`（或平台 buildpack）；选区域（**亚洲区，贴近 Postgres + 国内延迟**）；
  部署工作流（`fly deploy` / Cloud Run deploy）；env/secrets（`DATABASE_URL`、`SESSION_SECRET`、
  `R2_*`、AI keys）；定时任务（grading drain / retention）走平台 cron 或保留 GitHub Actions 打路由。
- **验证**：部署到 **staging**，§3 冒烟。
- **风险**：连接池大小、冷启动、区域选择。

### 阶段 3 · Staging 冒烟（验 CI 验不了的运行时）
- 登录(server action)→ 提交录制 → R2 直传 → AI 批改出分 → 老师改分；中间件/安全头/静态缓存；
  Console 无 hydration 错。**全绿才进数据迁移。**

### 阶段 4 · 数据迁移演练（最危险一步）
- **目标**：把 v1 的 D1 数据搬进 Postgres，**先演练、可重复、可校验**。
- **改动/脚本**：`wrangler d1 export` 导出 → 转换脚本（SQLite dump → PG，处理 boolean/
  datetime/enum/自增序列）→ 导入 Postgres → **行数/校验和比对**。
- **完成标准**：演练库与 v1 数据逐表行数一致、抽样比对一致；脚本可一键重跑。
- **风险**：类型转换错漏、外键顺序、`@updatedAt`/序列重置。**这步必须演练充分。**

### 阶段 5 · 切换上线
- 选**维护窗口** → v1 置只读 / 短暂停写 → 跑阶段 4 的迁移（导最新数据）→ 切 DNS/域名到 v2
  → §3 冒烟 → 观察。**v1 保留为回滚兜底**，稳定一段时间后退役。
- **回滚预案**：切回 v1 域名（v1 一直在跑、数据是切换点快照）。

### 阶段 6 · 新能力（v2 地基之上）
- **知识库（RAG）**：教学内容/语法/例句/题库 → embedding → **pgvector**（同库）检索，喂给
  AI 评语/答疑。
- **知识图谱**：概念→例句→掌握度→先修关系 → **先用递归 CTE**（够用）→ 真大了再上专用图库。

---

## 3. 待定决策（开工前/中拍板）

| 决策 | 选项 | 倾向 |
|---|---|---|
| 计算平台 | Fly.io / Cloud Run / Railway | **Fly.io**（可选亚洲区、贴 DB、好跑后台） |
| Postgres 托管 | Neon / Supabase | 纯库选 **Neon**；要控制台/Auth 选 Supabase。**生产用 Pro 档(~$25/mo)**，免费档 500MB 会被 AI 结果 JSON 撑爆 |
| 区域 | 亚洲(东京/新加坡/香港) | 用户地理集中(某校)，单区域即可 |
| 向量库 | pgvector / 专用(Qdrant/Pinecone) | **先 pgvector**(同库)，撑不住再拆 |
| 图谱 | CTE / Apache AGE / Neo4j | **先 CTE**，核心化再上 Neo4j |
| 视频留存 | `VIDEO_RETENTION_DAYS` | 建议 **90 天**(媒体永久 ~$7/mo,见 OPERATIONS §12) |

---

## 4. 风险与并行管理

- **双仓库分叉窗口**：v2 建好后与 v1 无共享 history，v1 若改 bug 要手动搬。对策:**v1 进
  「功能冻结」**(只接关键 bug/安全修)、**v2 尽快推**(初期两边几乎一样、搬 fix 容易)、
  切换后**退役 v1**。
- **运行时不可在合并前完全验证**:Fly/Cloud Run + Postgres + 原生 Next.js 这套需**真部署到
  staging** 才能确认(阶段 3),与 v1 的 `_headers` 那次同理但规模大。
- **数据迁移**是唯一不可逆、动真数据的步骤 → 阶段 4 演练充分 + 阶段 5 留 v1 兜底。
- **媒体永远 R2**,任何阶段都不动。

---

## 5. 一句话

**v2 = 同一个应用、换掉数据层与运行时的「地基」**:Postgres(pgvector)+ Fly/Cloud Run 原生
Next.js + R2,在干净的模板新仓库里平行建,验证充分后一次性切换;85–90% 的成熟代码原样保留,
真正新做的是「连接/部署那一层」+「知识库/知识图谱」。
