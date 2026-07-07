# 运维手册 / Operations Runbook

面向**操作者**（部署、值守、排障）的实操手册。架构设计见 `docs/ARCHITECTURE.md`，
本地开发见 `README.md`。本文只讲「线上怎么跑、怎么修」。

平台：Next.js 15（App Router）→ OpenNext → **Cloudflare Workers**；数据 **D1**（SQLite）+
Prisma 7；媒体 **R2**；会话 iron-session。生产域名 `https://www.hihomework.com`。

---

## 1. 资源与绑定 / Resources & bindings

`wrangler.jsonc` 是基础设施的单一事实来源：

| 绑定 | 类型 | 资源名 | 用途 |
|---|---|---|---|
| `DB` | D1 | `recitation-db`（`database_id` 见 `wrangler.jsonc`） | 全部业务数据 |
| `BUCKET` | R2 | `hihomework` | 媒体对象（服务端读/删） |
| `ASSETS` | 静态资源 | `.open-next/assets` | OpenNext 产出的前端静态文件 |

> 媒体的**上传/下载**走 R2 的 S3 兼容 API（`aws4fetch` 预签名），由 `R2_*` 这组
> secret 驱动（见 §3），与原生 `BUCKET` 绑定是两条不同的访问路径，两者都要配。

迁移目录 `d1/migrations`（`wrangler.jsonc` 的 `migrations_dir`）。可观测性已开启
（`observability.enabled = true`）。

---

## 2. 一次性开通 / First-time provisioning

```bash
# ① 建资源（账号内一次）
npx wrangler d1 create recitation-db        # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create hihomework

# ② GitHub 仓库 secrets（部署流水线用）——仓库 Settings → Secrets and variables → Actions
#    CLOUDFLARE_API_TOKEN   （Workers 编辑 + D1 + R2 权限的 API Token）
#    CLOUDFLARE_ACCOUNT_ID
#    CRON_SECRET            （定时任务鉴权，见 §6；不设则两个 cron 自动跳过）

# ③ Worker 运行时 secrets（逐个；只设一次，不随部署变）
npx wrangler secret put SESSION_SECRET      # ≥32 字符随机串
npx wrangler secret put CRON_SECRET         # 与 GitHub 的 CRON_SECRET 同值
npx wrangler secret put R2_ENDPOINT         # 及 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
npx wrangler secret put RESEND_API_KEY      # 邮件（可选）
# AI keys（按需，至少一个）：GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / …

# ④ 非敏感配置走 wrangler.jsonc 的 vars（APP_URL / APP_NAME / VIDEO_RETENTION_DAYS …）
#    或 npx wrangler secret put 同样可行；secret 优先级更高。
```

部署后启动会打一条**脱敏**诊断日志（只报变量名 + 在/不在，从不打印值）——
缺必需项报 `[config] missing required env: …`，可选功能未配报
`[config] optional features disabled: …`。用 `wrangler tail` 看（见 §8）。

---

## 3. 环境变量与密钥 / Environment & secrets

全部 env 读取都收口在 `src/lib/config.ts`（别处不直接读 `process.env`）。

**必需（缺了不安全启动）：**

| 变量 | 设在哪 | 作用 | 缺失后果 |
|---|---|---|---|
| `SESSION_SECRET` | Worker secret | iron-session 加密密钥（**≥32 字符**） | 无法签发/校验会话；诊断日志报缺失 |
| `APP_URL` | var / secret | 站点绝对地址（邮件链接、重定向、cron 目标） | 邮件链接/重定向失效 |

**可选（缺了对应功能优雅降级，不崩）：**

| 变量 | 设在哪 | 作用 | 缺失后果 |
|---|---|---|---|
| `APP_NAME` | var | 站点显示名 | 用内置默认名 |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Worker secret | 媒体预签名上传/下载（S3 API） | `storage` 功能关闭：学生无法上传录音/录像 |
| `RESEND_API_KEY` | Worker secret | 邮件发送（验证/找回密码/邀请） | `email` 功能关闭：相关邮件不发 |
| `EMAIL_FROM` | var / secret | 发件人地址 | 用 `onboarding@resend.dev` |
| `ADMIN_EMAIL` | var / secret | 标识平台管理员邮箱 | 无 |
| `CRON_SECRET` | Worker secret **+** GitHub secret | 保护 `/api/cron/*` 定时路由 **与 `/api/admin/*` 维护路由**（见 §6 末） | 两个定时任务全部跳过（drain/retention 不跑）；维护端点 401 |
| `VIDEO_RETENTION_DAYS` | var | 录像保留天数；`0`/未设/非法 = **永不删** | 保留清理不执行（数据无限留存） |
| AI provider keys（见下） | Worker secret | AI 评阅 / 转写 | `ai` 功能关闭：评阅停在「待批」队列，老师手批 |

**AI provider 变量**（至少配一个 key，AI 功能即可用；缺 key 的 provider 自动降级）：

| Provider | Key | Base URL 覆盖（可选） | 备注 |
|---|---|---|---|
| Gemini | `GEMINI_API_KEY` | `GEMINI_BASE_URL` | |
| OpenAI（GPT-4o judge + **Whisper 转写**） | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | Whisper 与 GPT 共用此 key |
| Anthropic（Claude judge） | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | |
| Qwen | `QWEN_API_KEY` | `QWEN_BASE_URL` | |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` | |
| MiniMax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL` | 另需 `MINIMAX_GROUP_ID` |

> 老师还能在「个人设置 → AI」里**自带密钥（BYOK）**，加密存库、按 `(userId, provider)`
> 隔离；其作业优先用老师自己的 key，空则回落平台 key。

**AI 评分校准 dials**（全部可选，用于按线上「老师改分」信号微调「AI 先批、只看例外」的松紧；
缺失=用出厂默认；非法/越界值会被**夹到安全区间**，绝不会弄坏评分）：

| 变量 | 设在哪 | 作用 | 默认 · 范围 |
|---|---|---|---|
| `REVIEW_CONFIDENCE_THRESHOLD` | var | AI 自评置信度 ≥ 此值且无作弊标记 → 免老师复核自动定稿；调高=更谨慎（更多进人工） | `0.85` · `0..1` |
| `SHADOW_ACCURACY_WEIGHT` | var | 逐句跟读分 = 准确度·w + 完整度·(1−w) 里的 w（准确度权重） | `0.7` · `0..1` |
| `SHADOW_AUTOPASS_OVERALL` | var | 跟读整体分 ≥ 此值（且最弱句 ≥ 下方）才免复核 | `85` · `0..100` |
| `SHADOW_AUTOPASS_MIN` | var | 跟读最弱一句 ≥ 此值（且整体 ≥ 上方）才免复核 | `60` · `0..100` |

---

## 4. 部署 / Deploy

**自动（默认路径）**：合并到 `main` → `.github/workflows/deploy.yml` 触发：
`npm ci` → `prisma generate` → **`d1:migrate`（远程 D1 应用 `d1/migrations`）** →
`cf:deploy`（OpenNext 构建 + 部署到 Workers）。需要仓库 secrets
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。`concurrency` 会取消同 ref 的旧部署。

**手动重跑**：Actions → `Deploy to Cloudflare` → `Run workflow`（`workflow_dispatch`）。

**本地应急部署**（绕过 CI，需本地装好 wrangler + 登录）：
```bash
npm run d1:migrate        # 先迁移
npm run cf:deploy         # 再部署
```

**CI 闸门**（`.github/workflows/ci.yml`，每次 push/PR）：`lint` → `tsc --noEmit` →
`test`（vitest）→ `build`。四步全绿才该合并。

---

## 5. 数据库迁移 / Migrations

**双轨**：`d1/migrations/NNNN_*.sql`（线上由 wrangler 应用）与
`prisma/migrations/<ts>_*/migration.sql`（本地 Prisma dev 用）。两者 SQL 必须**逐字节一致**，
`migrations.test.ts` 会校验逻辑名 1:1 对应。

**新增迁移**：
1. 改 `prisma/schema.prisma`；
2. 生成/手写两份 SQL（同一套语句，分别落到 `d1/migrations` 与 `prisma/migrations`）；
3. 本地验证：`npm run d1:migrate:local`（应 EXIT 0）；
4. `npx tsc --noEmit && npm test`（含 migrations 一致性测试）；
5. 合并 `main` → 部署流水线自动 `d1:migrate` 远程应用。

> D1/SQLite 约束：**改列可空性/类型需整表重建**（`PRAGMA defer_foreign_keys = ON/OFF`
> 包裹，先后建表、搬数据、换名）。先例见 `0003 / 0022 / 0025 / 0037`。
> D1 **不支持交互式事务**：嵌套自增 `create` 放进 `$transaction` 会失败——拆成独立
> create；`createMany` / `$transaction([deleteMany, createMany])` 可用。

**回滚**：迁移**向前修复**为主（D1 无自动降级）。误迁的处置：
- 写一条**新的反向迁移**（如刚加的列再删/改回）走同一流程上线；
- 数据层面误删，用 §10 的 D1 导出备份恢复；
- 切忌手改已应用的历史迁移文件（会破坏 `d1_migrations` 记账与一致性测试）。

---

## 6. 定时任务 / Scheduled jobs

**不用** Cloudflare 原生 Cron Trigger（OpenNext 下需自定义 Worker `scheduled` 入口，
无法本地验证，有意规避），改由 **GitHub Actions 定时**打受 `CRON_SECRET` 保护的路由。

| 任务 | Workflow | 频率 | 打的路由 | 开启条件 |
|---|---|---|---|---|
| 评阅队列排空 | `grading-drain.yml` | `*/5 * * * *` | `POST /api/cron/drain` | `CRON_SECRET` 已设 |
| 媒体保留清理 | `retention.yml` | `0 3 * * *`（03:00 UTC） | `POST /api/cron/retention` | `CRON_SECRET` 已设 **且** `VIDEO_RETENTION_DAYS > 0` |

- 鉴权头：`Authorization: Bearer <CRON_SECRET>`；非 200 视为失败（CI 步骤会 `test code=200`）。
- GitHub 定时是**尽力而为**（≈5–15 分钟漂移），评阅另有「提交后即时 kick」+「老师开面板自愈重扫」兜底，足够。
- **手动触发**：Actions → 对应 workflow → `Run workflow`。
- 未设 `CRON_SECRET` 时 workflow **主动跳过并成功退出**（不报红）。

**维护端点（同一 `CRON_SECRET` 鉴权,人工 curl 触发,无定时器）**：

| 端点 | 作用 | 注意 |
|---|---|---|
| `POST /api/admin/unify-poll-phase` | 把同名作业指定序号上误配成「默写文本」的环节统一改型为「单选投票」并自动归票（一次性数据修复;老师自助版在评分页「统一其它班为本投票」） | **`schoolId` 必填**（标题全平台不唯一,钉租户防误伤）；默认 dry-run 零写入,`"apply":true` 才执行；有评分即拒绝；可安全重跑。轮换 `CRON_SECRET` 时此端点同受影响 |
| `POST /api/admin/backfill-writing-grading` | 给「AI 文本评分上线前就已提交、从未入队」的写作类提交补建评阅任务（body: `schoolId`+`title`）;顺带清纯投票环节的幽灵复核标记 | 同上:`schoolId` 必填、默认 dry-run、可安全重跑（重跑=重置任务）。只碰 已上传/已标记+无 AI 分+文本非空 的写作行;有答案键的客观题 needsReview 是「答案键缺失转人工」的正路,不清。补登后队列由 5 分钟一班的 drain 消化（~10 份/班） |
| `POST /api/admin/probe-media` | **只读诊断**:在 Worker 环境（评阅同款取件路径）探测待评提交的视频对象是否在 R2,按 存在/缺失(404)/其它 计数、按环节与时长分桶（body: `schoolId`+`title`） | 一批 ≤40 个（Workers 子请求上限）,拿返回的 `nextAfterId` 作下一次 `afterId` 续查,直到报「no probe targets」。零写入;报告只含提交 id 与聚合数,无对象键/学生信息 |
| `POST /api/admin/requeue-media-grading` | 把「评阅失败/卡死处理中/未评」且带媒体指针的提交批量重置入队重评（body: `schoolId`+`title`;与探针同口径） | 同款约定:`schoolId` 必填、默认 dry-run、可安全重跑（重跑=重置任务、attempts 归零）。先跑探针确认对象健在再 apply;缺失/空文件的行会在评前预检下快速走到「评阅失败」,老师人工处理 |

**维护端点怎么调(`admin-call.yml`,推荐)**：GitHub 仓库 → Actions → `Admin maintenance
call` → `Run workflow`,选端点、贴 JSON body → 运行结束点进任务日志看结果。CRON_SECRET
待在仓库 secrets 里,不需要在本地摆弄密钥;每次调用连参数带结果留档可审计。
(本地 curl 依旧可用,命令见各端点行。)

**生产 D1 只读查询（`d1-query.yml`,手动触发）**：Actions → `D1 read-only query` →
`Run workflow`,输入一条 SELECT,结果打进任务日志。复用部署同款 token(不新增密钥);
守卫只放行单条 `SELECT`/`WITH…SELECT`,写关键词一律拒绝。**最小披露约定**:优先聚合/
计数,非必要不查学生姓名/作答原文——查询与结果都会留在 Actions 日志(私有仓库,默认
保留约 90 天)。

排障见 §9。

---

## 7. 密钥轮换 / Secret rotation

| 密钥 | 轮换步骤 | 影响 |
|---|---|---|
| `SESSION_SECRET` | `wrangler secret put SESSION_SECRET` 设新值 → 重新部署 | **全部在线会话失效**，用户需重新登录 |
| `CRON_SECRET` | 先改 GitHub secret，再 `wrangler secret put` 设同值（两端必须一致） | 短暂不一致期内 cron 返回 401；改完即恢复 |
| `R2_*` | R2 控制台轮换 Access Key → 逐个 `wrangler secret put` → 部署 | 轮换间隙预签名可能失败，建议低峰执行 |
| AI provider key | 在对应平台轮换 → `wrangler secret put` → 部署 | 仅该 provider 受影响，其余继续 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 重新签发 → 更新 GitHub secret | 只影响部署流水线，不影响线上运行 |

> 切记：secret 只存在于 Worker / GitHub Secrets，**绝不**写进代码/仓库/日志。
> `config.ts` 的诊断只报「在/不在」，从不打印值——保持这条红线。

---

## 8. 监控与可观测性 / Observability

- **实时日志**：`npx wrangler tail`（看启动诊断、`console.error/warn`、cron 命中）。
- **Workers Observability** 已开启 → Cloudflare 仪表盘看请求量/错误率/CPU。
- **结构化日志**：服务端用 `[模块名] …` 前缀（如 `[config]`、`[autoGradeSubmission]`、
  `[gradeShadowSubmission]`），便于在 tail/仪表盘里筛。
- **GitHub Actions**：Deploy / CI / 两个 cron 的运行历史在 repo 的 Actions 页；
  cron 失败会在那里留红。

---

## 9. 常见故障排查 / Troubleshooting

| 症状 | 可能原因 | 处置 |
|---|---|---|
| AI 不评分，全卡「待批」 | 无任何 AI key；或 key 失效 | `wrangler tail` 看是否 `optional features disabled: ai` / `未配置`；补/换 key 后部署 |
| 学生无法上传录音录像 | `R2_*` 未配齐或失效 | tail 看 `storage` 是否关闭；核对四个 `R2_*`；R2 凭据是否过期 |
| 验证/找回密码邮件不发 | 无 `RESEND_API_KEY` | 配置后部署；或确认是有意关闭 |
| 评阅迟迟不自动跑 | `CRON_SECRET` 未配 / drain workflow 失败 | 查 Actions `grading-queue-drain` 运行记录；手动 `Run workflow` 验证；确认两端 secret 一致 |
| 录像一直不清理 | `VIDEO_RETENTION_DAYS` 为 0/未设，或 retention workflow 失败 | 设正整数 var；查 `media-retention-sweep` 运行记录 |
| cron 返回 401 | 两端 `CRON_SECRET` 不一致 | 重设使 GitHub 与 Worker 同值 |
| 部署失败在 `Apply D1 migrations` | 迁移 SQL 报错 / 与历史冲突 | 看 Actions 日志定位 SQL；本地 `d1:migrate:local` 复现修复；勿手改历史迁移 |
| 部署失败在 build | lint/tsc/test 未过 | 本地跑全套（§4 CI 四步）复现修复 |
| 登录异常 / 一直要求重新登录 | `SESSION_SECRET` 变更或缺失 | 确认已设且 ≥32 字符；刚轮换则属预期（全员重登） |
| 站内链接/重定向地址不对 | `APP_URL` 缺失或写错 | 设为生产绝对地址并部署 |

---

## 10. 灾备与回滚 / Backup & DR

- **回滚一次坏部署**：在 Cloudflare Workers 的 *Deployments* 里把流量切回上一个版本；
  或 `git revert` 后合并 `main` 触发重新部署。**注意**：代码可回滚，**已应用的 D1
  迁移不会自动回退**——若坏在数据结构，需走 §5 的反向迁移。
- **D1 备份/导出**：
  ```bash
  npx wrangler d1 export recitation-db --remote --output backup-$(date +%F).sql
  ```
  建议定期导出留存（尤其重大迁移前先导一份）。恢复用 `wrangler d1 execute … --file=`。
- **R2 媒体**：对象存于 `hihomework` 桶；如启用了保留清理，过期录像会被删除（不可恢复），
  这是设计行为。需长留的内容不要设 `VIDEO_RETENTION_DAYS`。

---

## 11. 部署后健康检查 / Post-deploy checklist

1. `wrangler tail` 启动诊断无 `missing required env`；`disabled features` 符合预期。
2. 打开站点能登录（会话正常 → `SESSION_SECRET` OK）。
3. 学生端能录音并上传成功（→ R2 OK）。
4. 提交一份作业，约 5 分钟内自动出 AI 评阅，或老师面板能手动评（→ AI / drain OK）。
5. Actions 里 `Deploy` 绿、最近一次 `grading-queue-drain` 返回 200。
6. （若启用）`media-retention-sweep` 当日 03:00 UTC 后运行记录为绿。

---

## 12. 媒体存储与留存成本 / Media storage & retention sizing

学生录像/录音是唯一会**持续累积**的成本项：大小由录制规格决定，增长由 §6 的留存窗口
封顶。这里给「留存设多少天」的定量依据；**怎么设**见 §3 的 `VIDEO_RETENTION_DAYS`。

**单条大小**（`recorder.tsx`）：视频 720p、**无显式码率上限**（浏览器默认，约 1.5–2.5 Mbps）、
**无时长硬上限** → 约 **10–20 MB/分钟**；纯音频（Opus ~128 kbps）约 **1–2 MB/分钟**。

**R2 计费**（关键）：存储 **$0.015/GB·月**；**出口流量免费**（给老师/学生放视频不额外花钱）；
上传/读取 op 每月仅几分钱、可忽略。**所以媒体成本 ≈ 只看「当前留存了多少 GB」。**

**留存窗口 → 稳态存储**：设月增量为 `G` GB，则稳态存储 ≈ `G × 留存月数`，月费 = 稳态 × $0.015。
窗口越短、存得越少、越省，但能回看的历史也越短——按教学需求权衡。

**当前规模实算**（400 学生 × 4 次/月 × ~100 MB ⇒ 月增 **G ≈ 160 GB**）：

| `VIDEO_RETENTION_DAYS` | 稳态存储 | R2/月 | 说明 |
|---|---|---|---|
| **0 / 未设（默认）** | **无上限** | 第1年 ~$29 → 第2年 ~$58 → … | 永不删，月增约 **+$2.4/月** 永久累加 |
| 365（≈全学年） | ~1.9 TB | ~$29（持平） | 全年可回看 |
| 180（≈一学年半学期） | ~0.96 TB | ~$14（持平） | |
| **90（≈一学期，推荐起点）** | **~0.48 TB** | **~$7（持平）** | 前 3 个月爬坡到位后不再涨 |

**建议**：默认「关」会让存储**无限增长**，除非确有「永久留存」的合规/教学需求，否则**设一个正整数**。
按「需要回看多久」挑窗口——**90 天≈一学期（媒体永久 ~$7/月）**、365 天≈全学年（~$29/月）。
改动即时生效，次日 03:00 UTC 的 sweep 按新窗口清理过期对象（不可恢复，见 §10）。

> 进一步降存储：若想再省，可在 `recorder.tsx` 给 MediaRecorder 设 `videoBitsPerSecond`
> （如 1 Mbps）或加录制时长上限——存储与成本按比例下降。属产品取舍，本手册仅记其可行。
> （当前 ~100 MB/条 ≈ 8 分钟视频，偏大。）
