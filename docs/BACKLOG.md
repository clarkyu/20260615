# 待办 Backlog（PR 队列）

> 来源：2026-06-19 全项目审计（A 区＝应用层打磨/补测，B 区＝已知限制/基础设施）。
> 工作方式：**手动合并模式** —— 每条 build → push → 开 draft PR → 由 clark 合并。
> 增量编号承接已完成的 **增量68**（题库发布前内嵌编辑），故本队列从 **增量69** 起。
> 优先级 P1→P4 即建议执行顺序；同一 P 内自上而下。

## P1 · 纯应用层，小而高价值（增量69–73，建议优先）

| 增量 | 标题 | 来源 | 范围 / 做法 |
|---|---|---|---|
| 69 | 评阅链路失败可见化 | A2＋A5 | 媒体 presign 失败时不再静默降级评分：标注「未含视频/音频，凭文本评分」或作为可见错误；analytics `aiResult` JSON 解析失败时 log 并在页面标注「数据解析失败」，不再静默显示 0 准确率 |
| 70 | 名单导入跳过行反馈 | A3 | `commit` 阶段批量回退时被静默跳过的「学号冲突」行计数并回传，沿用增量66 的失败明细思路在结果里告知老师 |
| 71 | 补关键单测 | A1 | 邀请 token 单次性/过期（`repo/invites.ts` 的 fenced `updateMany`/`revoke`/`findValidByHash`，安全关键）＋ `domain/schools`、`staff`、`authoring` 的去重/降级路径 |
| 72 | 多阶段作业导出拆列/说明 | A4 | 导出把各阶段分数平均成单个 finalScore 易误导：加阶段分列，或在表头/文档明确口径 |
| 73 | 项目自描述同步 | A7＋A9 | `aiConfigured()` 改为检查任一已配置 provider（非仅 Gemini），修正启动诊断；同步更新 README「迁移进度」（CI/CD 已落地、AI 已接多家、Excel 已换 SheetJS 等过期条目） |

## P2 · 健壮性 / 体验，无需付费（增量74–77）

| 增量 | 标题 | 来源 | 范围 / 做法 |
|---|---|---|---|
| 74 | 邮件发送失败回传标志 | A6 | 重置密码/邀请邮件发送失败时返回 `emailFailed` 标志，UI 提示「邮件可能未送达」，不再一律显示成功（仅在 email 已配置时有意义） |
| 75 | 后台评阅慢作业防重领 | B3 | 20+ 句跟读可能超 `STALE_MS` 被重领→重复执行（终态写入已有 `PROCESSING` 围栏，不会脏写，仅白算）：调大阈值或加任务心跳 |
| 76 | gradebook 导出分页/上限 | B5 | `listForOfferingLatestFirst` 无分页/上限，超大班级有内存压力：加上限或分批 |
| 77 | PWA 真实图标 | B6a | 用真实图标替换占位，补全 manifest 各尺寸 |

## P3 · 较大 / 需产品决定 / 定时任务（增量78–81）

| 增量 | 标题 | 来源 | 范围 / 做法 |
|---|---|---|---|
| 78 | 隐私同意 UI | B6b | 录像/采集前的隐私同意与告知（合规） |
| 79 | 视频留存定期清理 | B6c | 按留存策略定期清理 R2 旧视频（Cloudflare Cron Trigger + 清理任务） |
| 80 | Whisper(perception) 接真实 API | A8a | 当前为占位 stub；已有 Gemini/Qwen/OpenAI 真实可用并优雅降级，**可选，待产品确认是否要这家** |
| 81 | Claude(judge) 接真实 API | A8b | 当前为占位 stub；已有 Gemini/Qwen/MiniMax/DeepSeek/GPT-4o 真实 judge，**可选，待产品确认** |

## P4 · 基础设施（已重新评估，2026-06）

| 增量 | 标题 | 来源 | 结论 / 做法 |
|---|---|---|---|
| — | 限流迁移 Durable Object | B1 | **跳过**。复核发现现有限流**已是 D1 共享存储**（`rate-limit.ts` 主路径 `checkRateLimitD1`，跨 isolate 一致），README 说的「进程内 Map 偏弱」其实已解决；DO 仅是省每次 D1 写的边际优化，却要冒 OpenNext Worker 入口改造（无干净注入点、运行期无法本地验证、改错断所有部署）的风险，不划算。 |
| 82 | 后台评阅定时排空（安全 drain 版） | B2 | **采用安全方案**替代原生 Queues：受保护 `POST /api/cron/drain` 路由 + GitHub Action 每 ~5 分钟排空 D1 评阅队列，让评阅不再等人开看板触发。复用现有持久队列（退避/死信/心跳/幂等），零 Worker 入口改造、可完整验证。原生 Cloudflare Queues（秒级、平台托管）需自定义 Worker `queue()` 入口，运行期不可本地验证、风险高，**故不采用**——正式提交本就异步、老师事后复核，分钟级延迟无感（秒级实时已由同步评的「练一练」覆盖）。 |

## Parked · 条件触发，不预编号

- **部门/专业删除时置空外键**（B4）：D1 无真外键（SQLite `ADD COLUMN` 限制），目前**无删除入口故触发不到**；仅当将来新增「院系/专业删除」功能时，在应用层先把 `majorId/departmentId` 置空，与该功能同一 PR 一并做。

## 审计中复核为「非问题」的项（不入队，备查）

- `findGradable` 不带 schoolId：job 的 submissionId 只来自已鉴权、按校隔离的入队路径，评阅是内部操作、不向用户暴露跨校数据，终态写入有 `PROCESSING` 围栏 → 非真漏洞。
- `emailConfigured()`/`aiConfigured()`：用于启动诊断 `configReport()`，并非死代码（`aiConfigured` 的覆盖面问题已收进增量73）。
- 邮箱验证「禁用」：刻意设计（注册即可用）。
- i18n zh/en/es 三语 740 键完全对齐；空串后缀（人/个/分/级）为中文量词，英西留空正确。
