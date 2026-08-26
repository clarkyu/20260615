# CLAUDE.md · zsb-qbank

## 项目

湖北专升本《大学英语》移动题库：学生用手机（主要在微信内置浏览器）作答、训练、模考；教师用电脑导入真题、发布任务、复核评分、看学情。完整设计见 `docs/SPEC.md`，那是唯一的需求来源；本文件只讲工作方式与硬约束。种子数据 `seed/paper-2025-hubei-english.json` 是 2025 年真题的结构化转写，也是 schema 的第一份验收数据（1 份试卷、6 个大题、8 个题组、43 个小题、总分 100）。

## 技术栈

Node.js 22 + pnpm；Next.js 15（App Router）+ React 19 + TypeScript strict；Tailwind CSS 4；PostgreSQL 16 + Drizzle ORM；zod；Zustand + Dexie；Serwist；Vitest + Playwright；Docker。AI 通过 OpenAI 兼容接口调用，配置全部来自环境变量（见 `.env.example`）。

## 常用命令

`pnpm dev` 开发；`pnpm lint`、`pnpm test`、`pnpm build` 是每个里程碑的准入门槛；`pnpm db:migrate` 迁移；`pnpm seed` 幂等导入种子；`pnpm test:e2e` 移动视口冒烟；`docker compose up db -d` 只起数据库。

## 硬约束（违反即为缺陷）

1. 参考答案与评分要点永远不发往客户端。所有返回试卷内容的接口都经过 `stripAnswers()` 序列化，且该函数有测试。
2. 判分逻辑只存在于 `src/lib/grading/`，是无副作用的纯函数，每条规则都有表驱动测试；种子试卷的每个客观题都有“参考答案得满分”的用例。
3. 英文作答只允许使用 `<EnglishInput>` 组件，其 `autoCapitalize / autoCorrect / spellCheck / autoComplete` 固定关闭，字号不低于 16 px。
4. `src/lib/schema/` 中的 zod schema 是内容模型的唯一事实来源，种子导入、API 入参、数据库 JSONB 列共用它；改模型先改 schema，再改其余。
5. 学生端页面：单列、`100dvh`、安全区、无横向滚动、不依赖左右滑动手势、可点击元素不小于 44 px；不引入重型 UI 库；首屏 JS（gzip）不超过 200 KB。
6. 考试计时以服务端 `deadline_at` 为准，客户端只显示。
7. 每次作答变更先写 IndexedDB 再进同步队列；断网不能丢数据。
8. 中文界面文案使用全角标点，中英文之间加空格；面向学生的文案简短、口语、不用术语。
9. 不提交任何密钥；`.env.example` 列出全部变量并注释。

## 工作方式

先读 `docs/SPEC.md`，再读 `docs/PROGRESS.md`（若存在）与 `docs/DECISIONS.md`（若存在）。按 SPEC §10 的里程碑推进，一次只做一个里程碑；里程碑结束时跑通 `pnpm lint && pnpm test && pnpm build`，把验收标准逐条自检结果写进 `docs/PROGRESS.md`（通过 / 未通过及原因），需要真机验证的条目写出具体操作步骤。SPEC 未覆盖的决策选最简单可行的方案并记录到 `docs/DECISIONS.md`，不要停下来等待确认；与 SPEC 矛盾之处以 SPEC 为准并在 PROGRESS.md 指出。小步提交，提交信息用中文，格式为 `M<n>: 一句话说明`。
