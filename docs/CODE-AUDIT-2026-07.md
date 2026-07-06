# 全面代码审计 · 2026-07-06（非 DB 面）

> 面向 **你好！作业 / Hi-Homework**（Next.js App Router + OpenNext on Cloudflare Workers + D1 + Prisma 7）。
> 方法：6 个专项审计员并行（架构一致性 / 认证安全 / 业务逻辑正确性 / 前端 React·a11y·i18n /
> AI 评阅管线 / 代码质量），每条结论回源码逐条核证。DB / 数据处理面已于 2026-07-05 单独审计并全清
> （见 `docs/DB-AUDIT-2026-07.md`），本轮聚焦非 DB 面。
>
> 「状态」：✅ = 已修（标 PR 号）· 🟡 = 部分 · ⬜ = 未修。修复按 **S2 → S3 → S4** 逐条开独立 PR。

## 严重度图例

| 级 | 含义 |
|---|---|
| **S1** | 可利用安全漏洞 / 静默持久错误数据 / 数据丢失 |
| **S2** | 现实输入或默认配置下的真实 bug |
| **S3** | 隐患 / 纵深 / 一致性 / 边缘 —— DB 或代码未强制 |
| **S4** | 细枝末节 |

## 发现清单

| # | 级 | 位置 | 一句话 | 状态 |
|---|---|---|---|---|
| A1 | **S1** | `actions/auth.ts` register | 匿名 register 覆盖未验证账号密码/角色 → 账号劫持 + 学生越权为老师 | ✅ #332 |
| A2 | **S2** | `assignments/[id]/export/route.ts:71` | 导出成绩单用等权平均，与全站加权 `collapsePhases` 矛盾（老师设权重后导出≠界面） | ✅ 本 PR（抽出 `weightedPhaseMean` 共用） |
| A3 | **S2** | `ai/providers/gemini.ts:120` | 少算 `thoughtsTokenCount` → 默认感知模型每次评阅系统性低报输出成本 | ✅ 本 PR（thoughts 折进 outputTokens） |
| A4 | **S2** | `ai/providers/anthropic.ts:42` | Claude 评分 `max_tokens:1024`，长评语截断 → JSON 解析失败 → 提交 FAILED/死信 | ✅ 本 PR（提到 4096） |
| A5 | **S2** | `components/assignment-form.tsx:221` | `toLocalInput` 在 SSR 用服务器时区算环节时间 → 编辑页水合不一致（仅显示） | ✅ 本 PR（时间改 mount 后 effect 里转本地，仿月份处理） |
| A6 | **S3** | `assignments/[id]/export/route.ts:22` | 导出 `classId` 未校验属于该作业 offering → 可取本校任意班名单 PII | ✅ 本 PR（改由作业 offering 派生班级，弃用 query 参数） |
| A7 | **S3** | `ai/providers/openai-compat.ts:90` | usage 缺 token 拆分时记成真实 $0（MiniMax 触发） | ✅ 本 PR（两拆分都缺 → undefined，落 null 非 $0） |
| A8 | **S3** | `ai/cost.ts` | Whisper 按分钟真实成本从不入库（`whisper-deepseek` 漏记转写费） | ✅ 本 PR（whisper 用 verbose_json 拿 duration，perceptionCostUsd 按分钟计价，grading/shadow/practice 三处接上） |
| A9 | **S3** | `ai/providers/openai-compat.ts:154` | 感知发 OpenAI 不接受的 `video_url` → `gpt-4o` 感知必 400（潜伏） | ✅ 本 PR（gpt-4o 去掉 perception 能力，删孤儿 openaiPerception；Qwen 的 video_url 保留） |
| A10 | **S3** | `domain/points.ts:89` | 老师标的 MISSING 缺交行虚增学生活跃天/连续打卡分 | ✅ 本 PR（活跃天循环跳过 MISSING） |
| A11 | **S3** | `repo/feedback.ts:5` | 积分政策常量在 repo 层重复（与 `domain/points.ts` 的 `PTS` 分叉风险） | ✅ 本 PR（repo 只返原始计数，总分由 domain `feedbackPointsTotal` 单源算） |
| A12 | **S3** | `actions/grading.ts:124` | 逐句 take 预签失败被静默丢弃、无日志（复核里该句凭空消失） | ✅ 本 PR（catch 里 logError 记 submissionId+order，留痕不再静默） |
| A13 | **S3** | `components/ui/confirm.tsx:70` | 最常用确认弹窗无可访问名 + 无焦点陷阱（另两弹窗都做了） | ✅ 本 PR（useId 的 aria-labelledby/describedby + Tab 焦点陷阱，对齐 RecordConsentNotice） |
| A14 | **S3** | `components/assignment-form.tsx:246` | 环节重排后手风琴展开态不跟随（index key + 未同步 `openPhase`） | ⬜ |
| A15 | **S4** | `fill-blank.ts:44` | `isGradableFillBlank` 把 `[[""]]` 空串答案键当可判分 | ⬜ |
| A16 | **S4** | `repo/ai-keys.ts:11`、`repo/users.ts:28` | 死导出 `findSecret` / `setSchool` | ⬜ |
| A17 | **S4** | `ai/providers/gemini.ts:214` | Gemini API key 走 URL query（建议改 `x-goog-api-key` 头） | ⬜ |
| A18 | **S4** | `points.ts` / `retention/route.ts` 等 | 魔法值 `DAY_MS` / `180_000` 超时 / `MAX_SCORE` 声明序等一致性小项 | ⬜ |
| A19 | **S4** | `student/.../shadow-submit.tsx:153` | `scrollIntoView` 写在 state updater 里（StrictMode 双触发） | ⬜ |

## 审计过、确认干净

- **认证授权**（除 A1）：预签 URL scoping、cron 鉴权、角色门、token 单次性/TTL、密码 PBKDF2 + 常量时间、
  BYOK 密钥加密不回传、XSS/CSP —— 均稳。
- **分层**：action/domain/repo 边界干净，`process.env` 只在 `config.ts`，无跨层违规。
- **评阅状态机 / GradingJob 队列**：终态写围栏、抢占、退避、去重、`decideReview` fail-safe —— 均正确。
- **i18n 用法、Server/Client 边界、双提交守卫、录制/练习/跟读生命周期** —— 均干净。

**结论**：架构与安全底子扎实；A1 是唯一 S1（已修）。其余为可控的一致性/正确性/成本口径/纵深项，按严重度逐条收口。
