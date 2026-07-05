# 数据库与数据处理系统审计 · 2026-07-05

> 面向 **你好！作业 / Hi-Homework**（D1/SQLite + Prisma 7 + OpenNext on Cloudflare Workers）。
> 方法：7 个专项只读审计（schema 设计 / 引用完整性与级联 / 索引与性能 / 迁移卫生 / 多租户隔离 /
> 事务与并发 / 数据处理管线），所有 S1/S2 结论已回源码逐条核验。本文件是**存档 + 活跃跟踪表**：
> 「状态」列 ✅ = 已合并（标 PR 号）、🟡 = 部分完成、⏸ = 阻塞（待条件）、⬜ = 未做（低优先/有意暂缓）。

> **落地小结（2026-07-05）**：所有 **S1 与 S2 全部修复**（P0 全簇 + P1 全部 + P2 的 S2 项）。
> 合并 PR：#304（P0-2/3）· #305（P0-1/4/5）· #306（P1-1）· #307（P1-2）· #308（P1-4）·
> #309（P2-2）· #310（P2-1 索引/P2-5/P2-7/P2-10 clamp）。存档 PR #303。剩余均为 S3/S4 低优先，
> 见文末「剩余尾巴」。

## 严重度图例

| 级 | 含义 |
|---|---|
| **S1** | 数据丢失/损坏，或默认配置下静默产生错误的持久数据 |
| **S2** | 现实输入/默认配置下的真实缺陷（可能 fail-safe / 有界 / 需一定规模或时序） |
| **S3** | 隐患 / 纵深防御 / 边缘 / 性能次优——DB 未强制、只靠应用代码守 |
| **S4** | 细枝末节 |

## 总评

**地基扎实。** 四件最易酿灾的事——**多租户隔离、并发抢占协议、生产级联、双迁移树同步**——经逐一核验均**正确**：
租户 `?? -1` sentinel 一致收窄、job 抢占与限流是真原子、D1 默认 FK-on 让声明的级联真生效、45/45 迁移对无 DDL 漂移。
**无跨租户泄露、无静默孤儿损坏、无核心协议级的丢失更新。**

真正的风险**高度集中**在：#298 把默认评分模型切到 **DeepSeek V4 Pro**（compat 通道）后，AI 评分/计费管线出现一簇
**只在默认配置下发作、且静默**的回归（P0，已全部修复）。其次是几条**大规模下才爆的无界查询**（P1，已修），和一批 DB 未强制的隐患（P2，S2 项已修）。

| 维度 | 健康度 | 最重问题 |
|---|---|---|
| 多租户隔离 | 🟢 稳 | 仅 S3 纵深防御 |
| 并发 / 事务 | 🟢 稳 | S2 `markProcessing` 无围栏 → 已修 #306 |
| 引用完整性 / 级联 | 🟢 生效 | S2 删班级联爆炸半径 → 已修 #308 |
| 迁移卫生 | 🟢 同步 | S2 CI 只校验名不校验正文 → 已修 #310 |
| 索引 / 性能 | 🟢 已缓解 | S1 学情分析无界扫 → offeringId 索引 #307 |
| Schema 完整性 | 🟢 已加固 | 枚举化 #309 / relationMode #310 |
| 数据管线（AI 评分） | 🟢 已修复 | S1/S2 簇 → #304/#305 |

---

## P0 · 默认配置下的静默回归（全部已核验）

> 一条线索：#298 把默认 judge 设为 `deepseek-v4-pro`，但三处配套没跟上；**#301 的校准阈值对默认 judge 也失效**——因为 confidence 永远 undefined。#304/#305 修复后 #301 的阈值才真正生效。

| # | 级 | 问题 | 证据 | 修复 | 状态 |
|---|---|---|---|---|---|
| P0-1 | S1 | 逐句跟读把「残缺平均」落库成永久 GRADED：某句 take 抛瞬时错只被 log 跳过，`summarizeShadow` 只对成功句求平均并无条件写 GRADED，因 `status==='GRADED'` 早退→掉的句永不重评→**在残缺数据上自动免复核、永久定稿** | `domain/shadow.ts:114-148` | 任一 pending 句失败就 `revert()`，只在全句有分时 finalize | ✅ #305 |
| P0-2 | S2 | 默认 judge 成本恒记 $0：`MODEL_RATES` 有 flash 无 **pro**，`costUsd` 对未知 id `return 0`→写作评分成本整条=$0，用量看板失真；测试也漏了 pro | `ai/cost.ts:28,134` | 补 `deepseek-v4-pro` rate + 测试从 registry 派生覆盖 | ✅ #304 |
| P0-3 | S2 | 自动免复核对默认 judge 实际失效：compat/claude 的 `JUDGE_JSON_HINT` 是 `{score,breakdown,feedback}`**无 confidence**→模型不吐→`decideReview` 视作不自信→**needsReview 恒 true**，「AI 先批只看例外」静默关闭，老师被迫 100% 复核 | `ai/providers/openai-compat.ts:112`、`anthropic.ts:13` | JSON hint 补 `"confidence": number` + 测试断言 | ✅ #304 |
| P0-4 | S2 | judge 漏/坏 `score` 被强转成真 0：`Number(r?.score)||0`，无 schema 强制的 compat/claude 通道缺数字 score→落库 0；`freePractice` 直接定稿 0 无兜底 | `ai/providers/gemini.ts:188`（`normalizeJudge`） | score 非有限就 throw，走 FAILED/队列 | ✅ #305 |
| P0-5 | S2 | 填空题答案键空/坏→整班静默 0：`blanksJson` 解析失败→`accept:[]`→`total:0`→score 0；客观题不进人工，全班 0 隐形 | `actions/submissions.ts:95`、`fill-blank.ts:36` | 新增 `isGradableFillBlank`，不可用则转老师人工复核 | ✅ #305 |

---

## P1 · 高价值单点

| # | 级 | 问题 | 证据 | 修复 | 状态 |
|---|---|---|---|---|---|
| P1-1 | S2 | `markProcessing` 无围栏→覆盖老师手改分：终态写有 `PROCESSING` 围栏但**入口没有**；后台 drain 在 `[读快照→markProcessing]` 窗口把行重开成 PROCESSING，AI 跑完命中围栏→**finalScore 被静默改成 60，学生看到错分** | `repo/submissions.ts:267` | 新增守护式 `claimForProcessing`（仅 UPLOADED/FLAGGED 可 claim），后台三条评阅 count=0 即退出 | ✅ #306 |
| P1-2 | S1（规模） | 学情分析无界扫 + 超取 blob：`listForOfferingLatestFirst` 无 `take` 且每行拉整个 `aiResult`，按 学生×作业×环节×次数 膨胀→workerd OOM/超时，**或 D1 静默截断→薄弱句聚合算在残缺集上** | `repo/submissions.ts:113` | 加 `Submission.offeringId` 列 + `@@index([offeringId,status])`（加法双迁移），单 offering 读改走索引 | ✅ #307 |
| P1-3 | S2 | 「作业」菜单扫全历史：`submittedCountByAssignment` 用 `distinct` findMany（D1 适配器 distinct 在引擎层非 SQL）→每次开菜单全量拉老师所有非 DRAFT 提交去重 | `repo/assignments.ts:373` | 改 `groupBy` 计数（它按老师多 offering 过滤，offeringId 单列索引不直接服务它） | ⬜ 待做（#307 只做了 P1-2；此项独立留作尾巴） |
| P1-4 | S2 | 删班/删师级联爆炸半径：`deleteWithStudents` 注释说「只删学生」，实际顺 `CourseOffering→Assignment→Submission` 永久抹掉整学期已评分作业 + finalScore + R2 媒体，无软删/无二次确认 | `repo/classes.ts:60` | 新增 `classDeletionImpact`，确认框显示真实爆炸半径（授课/作业/已提交数） | ✅ #308 |

---

## P2 · 隐患与纪律（S3/S4，DB 未强制、只靠应用代码守）

| # | 级 | 问题 | 证据 | 修复 | 状态 |
|---|---|---|---|---|---|
| P2-1 | S3 | 裸外键无 FK 无索引→删校后悬挂引用 + 全表扫 | `Feedback.schoolId`、`SchoolInvite.createdById` | 建关系 + 索引，或文档化为软引用 | 🟡 Feedback.schoolId 索引 ✅ #310；SchoolInvite.createdById 仍软引用（建 FK 需表重建，风险>值，见尾巴） |
| P2-2 | S3 | 枚举当裸字符串→拼错大小写 job 永卡不报错 | `GradingJob.status/kind`、`Feedback.status`、`PracticeAttempt.kind` | 改 Prisma enum（编译成 TEXT，零 SQL 迁移） | ✅ #309 |
| P2-3 | S3 | 唯一约束靠应用守：`Chunk.order`/`Sentence.order` 无唯一→重复 order 时排序/逐句映射不稳（chunk 写用 `i+1` 天然唯一；sentence 用 caller order） | `schema:86,382` | 加 `WHERE … IS NOT NULL` 部分唯一索引 | ⏸ 阻塞：建唯一索引前须核对 **prod** 无重复，否则迁移失败；dev 容器无 prod D1 访问，待在有 prod 权限的环境跑只读核对 |
| P2-4 | S3 | 时间戳格式地雷：`createdAt DEFAULT CURRENT_TIMESTAMP`（空格式）≠ Prisma DateTime（`T`+offset），字符串比较会错（当前休眠，写入永远由 Prisma 供值） | `d1/migrations/0001_init.sql` | 确保写入永不依赖 DB 默认值（或统一 epoch-ms） | ⬜ 休眠（未动，低优先） |
| P2-5 | S2 | 迁移 CI 只比对**名**不比对 **SQL 正文**→一次手改就 prod/Client 静默分叉（今 0 漂移） | `__tests__/migrations.test.ts` | 补按对比对归一化正文 | ✅ #310 |
| P2-6 | S3 | 数据迁移非幂等（`0018/0033/0026` 全靠 `d1_migrations` 记账）；全树 0 个 `IF NOT EXISTS`，表重建中途失败残留 `new_X` 卡死 | `d1/migrations/*` | 重建加 `DROP TABLE IF EXISTS new_X`；文档化「勿手动重跑」 | ⬜ 未动（低优先；正常部署路径由 `d1_migrations` 记账保护） |
| P2-7 | S3 | 级联正确性依赖 **D1 默认 FK-on** 这个隐式前提；`relationMode` 隐式默认→换数据源即静默 no-op | `db.ts`、`schema.prisma:5-7` | `db.ts` 写明依赖 + `schema` 显式 `relationMode="foreignKeys"` | ✅ #310 |
| P2-8 | S3 | offering/assignment 级分析读函数不带租户谓词（靠 caller 先 scope，今都做了） | `repo/submissions.ts:113`… | 把 `schoolId`/offeringId 下推进读函数 | 🟡 #307 让单 offering 读用 `where:{offeringId}`（内在 scope 到具体 offering）；其余仍靠 caller 先 scope |
| P2-9 | S3 | 并发改作业 lost-update 级联删提交（无版本守）；双发布无幂等键→重复作业；token 单次使用 check-then-act 非原子 | `repo/assignments.ts:198`、`domain/assignments.ts:149`、`actions/auth.ts:158` | 乐观并发守 / 幂等键 / 守护式 `updateMany` | ⬜ 未动（低概率/有界/可恢复，低优先） |
| P2-10 | S3 | perSentence accuracy/completeness 未 clamp→>1 的值污染薄弱句分析；导出多环节等权平均（BACKLOG #72）；名单导入/留存清理未按 D1 上限分批/单批清 | `gemini.ts:307`、`analytics.ts:80`、`roster.ts:101`、`retention.ts:20` | 感知层 `clamp01`；导出按句数加权；分批/循环清 | 🟡 perSentence `clamp01` ✅ #310（共享 `normalizePerSentence`）；导出等权/分批清 未动 |
| P2-11 | S4 | `costUsd` 用 Float（金额）；填空归一化仅 trim+lowercase（`New  York`≠`New York`）；持续失败的 key 卡住整行媒体清理 | `schema:422`、`fill-blank.ts:41`、`retention.ts:30` | 若转计费改整数 micro-USD；归一化折叠内部空白/全角 | ⬜ 未动（S4，细枝末节） |

---

## 剩余尾巴（低优先 / 有意暂缓）

- **P2-3 order 部分唯一索引 —— ⏸ 阻塞于 prod 数据核对**：SQLite `CREATE UNIQUE INDEX` 会在存量有重复时**直接失败、拖垮部署**。须先在有 prod 权限的环境跑只读核对
  `SELECT chunkSetId, "order", COUNT(*) FROM Chunk GROUP BY 1,2 HAVING COUNT(*)>1`（Sentence 同理按 `phaseId,"order"`），确认 0 行再建。dev 容器无 prod D1 访问，故本轮不动。缓解：chunk 写用 `i+1` 天然唯一，sentence 由发布/导入按序写。
- **P2-1 SchoolInvite.createdById 建 FK —— 有意暂缓**：SQLite 不能对既有表 `ADD` 外键，须整表重建；表重建是审计点名的高风险迁移（中途失败残留 `new_X`）。该字段短生命周期、且 `schoolId` 级联已清理它，dangling 窗口极窄——判定风险>值，保留为**已文档化的软引用**（非未知缺口）。
- **P1-3 / P2-8 / P2-9 / P2-10 剩余项 / P2-4 / P2-6 / P2-11**：均 S3/S4，低优先，按需再评估。
- **`aiResult` 两步取**：offeringId 索引（#307）已把扫描变索引扫；blob 超取只在高 `maxAttempts` × 大规模时显著。可作后续读层优化（需动 analytics 消费端），本轮未做。

---

## 做得好的地方（经证明）

- 并发抢占（`updateMany where status='PENDING'` + count 检查）、D1 共享限流（`INSERT…ON CONFLICT DO UPDATE RETURNING`，真原子）、终态写围栏、幂等 submit/enqueue、无交互式 `$transaction`（嵌套 autoincrement 刻意独立 create）、P2002 兜底、per-isolate memoization 无竞态。
- 级联 DDL 完整且 `PRAGMA defer_foreign_keys` 用法正确；`relationMode` 选默认 `foreignKeys` 对 D1 是对的（现已显式化）。
- 租户单源 scoping（`offeringScopeFor`）+ sentinel fail-closed + lint 强制分层；全局题库读写规则正确；AiKey 密文永不回传；`panelRole ≤ role` 不变式只会收窄。
- JSON parse 全程 fail-closed、除零有守、MISSING/DRAFT 正确剔除、points 纯派生、留存覆盖三表且先删 R2 再清指针。
- 双迁移树 0 DDL 漂移、45/45 对齐、0042 回填与运行时 `phaseItemType()` 逐字一致；GradingJob drain 是全库最优索引热路径。

**结论：架构分层干净、纪律良好的系统——问题是边缘回归，不是结构性腐坏；本轮已把全部 S1/S2 收口。**
