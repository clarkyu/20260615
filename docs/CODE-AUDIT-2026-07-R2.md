# 全项目复查 · 2026-07-06 R2（上轮审计后增量 ~1800 行）

> 范围:`4e91940..main`(A11–A19 修复 + #351–#363 全部新功能)。方法:6 路专项并行
> (归票链 / 批次链 / 新 UI / 安全 scoping / 性能 / 一致性+测试+文档),56 条原始发现
> 去重为 24 项,S1/S2 逐条回源码亲自核证。上轮 A1–A19 见 `CODE-AUDIT-2026-07.md`。
>
> **安全面单独结论:0 个 S1/S2** —— 所有 by-id 写都有上游 scope 门(双重把关),
> 无跨租户 IDOR,无学生端 voteSourceText/他人数据泄漏,错误信息无内部泄漏。
>
> 「状态」:✅ = 已修（标 PR）· ⬜ = 未修。修复按 **R1 → S2 → S3 → S4** 逐条独立 PR。

## 发现清单

| # | 级 | 位置 | 一句话 | 状态 |
|---|---|---|---|---|
| R1 | **S1** | `assignments/[id]/page.tsx:46` | 重投草稿遮蔽已完成提交:已投票从分布消失、已交/已评行变「未提交」、误标「仅草稿」（违背 `submit.ts` 契约） | ✅ 本 PR（教师页复用 `representativeSubmission`:最新非草稿优先） |
| R2 | **S2** | 同页 pollSubs | 缺交(MISSING)标记计入投票 total/voters,虚增票基数、清空未投票名单,且不可见不可撤 | ✅ 本 PR（pollSubs 排除 MISSING;被标缺交者回归「未投票·未提交」） |
| R3 | **S2** | `poll-unify applyPlans` | 统一执行顺序不可安全重跑（改型最先写,中途失败→重跑跳过半成品班:幽灵待批 + 残留/在途 AI 任务可写分） | ✅ 本 PR（改型移到最后作提交点=重跑可修复;写作评阅入口加 objective 围栏,残留任务自弃不写分） |
| R4 | **S2** | `poll-unify isTextTargetPhase`×2 | 目标判定漏 `requireFreeText`/`requireHandwriting`,混合环节被错误改型成矛盾杂交型 | ✅ 本 PR（谓词补两旗标 + 合并重复定义为单一来源） |
| R5 | **S2** | `repo findDetailForStaff` | 评分页全量拉取每 attempt 全部字段（含 aiResult/transcript）≈ 每次点击 1–3.5MB D1 读,10–20× 过度 | ✅ 本 PR（提交行改显式 select、仅取页面消费的 18 字段;markMissing 同享收益） |
| R6 | **S3** | `api/admin/unify-poll-phase` | 加固包:按标题全平台匹配可跨租户误伤（补 schoolId 必填+报告带学校）、phaseOrder 非整数静默取 1、守卫无测试、OPERATIONS.md 未记载 | ✅ 本 PR（schoolId 必填并钉进查询;phaseOrder 非法即 400;守卫入 describe.each;OPERATIONS §6 补维护端点表） |
| R7 | **S3** | `poll-unify.ts:137,139` | 源文件含 2 个真实 NUL 字节 → git 视为二进制（不可 diff/blame/grep） | ✅ 本 PR（改写为 Unicode 转义序列,与 R4 同文件并修——不除 NUL 无法正常审 R4 的 diff） |
| R8 | **S3** | `poll-unify assign*` + 页面 | 归票/工作台未排除带答案键的单选（quiz）:改票不重判分,答案/正确率/分数矛盾 | ✅ 本 PR（assign/bulk/undo 三写路径加 quiz 围栏 err.pollOnlyAssign;页面对 quiz 不再出工作台） |
| R9 | **S3** | `findSyncSiblings` OR-title / `updateBatchMeta` | 改名标题连锁:泛匹配+默认全选可误写无关作业评阅配置;legacy 组改名可与同名组融合、卡片 remount 吞掉成功提示（修法:legacy 组批次写时铸新 batchId） | ⬜ |
| R10 | **S3** | 发布 targets / 批次卡 | 一次发布可跨课程勾班 → 批次卡课程名错标 + 永久不可归并 | ⬜ |
| R11 | **S3** | pollResults payload | 无上限文本载荷（20k 字 ×54×2 可至 MB 级）+ 最新文本前端不截断 | ⬜ |
| R12 | **S3** | `listForStaff` + 两个 groupBy | 作业列表无分页 + 全史扫描,随学年数据积累degrade | ⬜ |
| R13 | **S3** | `merge-form.tsx:75` | 课程分节 key 用可重名的 courseName → React key 冲突 | ⬜ |
| R14 | **S3** | grading-client 组卡/UnifyPanel | 组卡 key 不稳定（首 submissionId）+ 预览报告不失效（误导） | ⬜ |
| R15 | **S3** | poll-unify 报告 | 预览含空文本行（工作台不显示）、skipped 班级静默吞掉——报告与可操作数不一致 | ⬜ |
| R16 | S4 | i18n / assignment-mode | 死键 `poll.pickOption`/`poll.assign` ×3 语言;死导出 `AssignmentMode`/`isAssignmentMode` | ⬜ |
| R17 | S4 | grading-client / merge-form | 硬编码中文顿号「、」与全角括号绕过 i18n | ⬜ |
| R18 | S4 | `applyPlans`/`assignPollVotesBulk`/`cancelPending` | 逐行写 → `$transaction` 单次 batch;cancelPending 改关系过滤（phaseId） | ⬜ |
| R19 | S4 | `listPollAssignables`/`findForStaff` | 归票放行 DRAFT/MISSING 行（补 status 过滤）;bulk 跨作业只 revalidate 第一个 | ⬜ |
| R20 | S4 | 同页 options.count | 选项计数 label 未 trim,与 notes/correct 口径不一 | ⬜ |
| R21 | S4 | `actions/assignments.ts:132` | 客户端 batchId 无格式校验（可伪造超长串/复用他人批次串卡） | ⬜ |
| R22 | S4 | 看板 classesN | 「N 个班」= 待批班数,与列表页「发布班数」同键不同义 | ⬜ |
| R23 | S4 | 多处 | 命名漂移（edit/update/merge 三动词）· OptionButtons 抽取 · 纯函数入 lib 补测 · 注释「完全可逆」过强 · ARCHITECTURE jobs 例外补记 · generateMetadata 重复取数 · commonTitlePrefix 代理对 · setTitle 在 updater 内 | ⬜ |
| R24 | — | 明确不做 | batchId/title 索引（现规模无收益）、pollResults O(n²) 循环（<1ms）、rows RSC 载荷（≤60 人可接受）——防过度优化,留待规模触发 | 记录在案 |

## 审计过、确认干净

- **安全/租户边界**（专项):新增 7 个 by-id 写全部有上游 scoped 读把关(`mergeIntoBatch`/`updateBatchMeta` 的 where 内还二次带 scope);6 个新 action 全部 fail-closed;CRON 守卫常量时间比较;学生端零新增暴露。
- **迁移**:0053/0054 双树配对逐字节一致、可空加列合规。
- **i18n**:除 2 个死键外,所有引用键三语齐全、占位符匹配。
- **测试**:新增 domain 写路径(统一/归票/批量/撤销/归并/批次编辑)集成覆盖扎实,含越权整体拒绝与幂等。
- **A11–A19 修复自查**:与描述一致,无回归。
