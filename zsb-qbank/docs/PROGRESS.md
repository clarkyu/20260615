# PROGRESS

## M0 脚手架 + M1 内容模型与种子(2026-08-26)

门禁:`pnpm lint && pnpm test && pnpm build` 全部通过(lint 0 错误 0 警告;
Vitest 4 例;Next build 成功,standalone 输出)。

### M0 验收自检
- [通过] `pnpm dev` 可运行(Next.js 15 App Router + TS strict + Tailwind 4)。
- [通过] `GET /api/health` 返回 `{ ok: true }`。
- [通过] 开发登录:`AUTH_DEV_LOGIN=true` 时 `POST /api/auth/dev-login {"role":"teacher"}`
  → 会话 Cookie;`GET /api/me` 返回用户;`POST /api/auth/logout` 注销。
- [通过] 页面壳:单列、`min-h-dvh`、安全区 padding、`overflow-x: hidden`、
  基准字号 17px/行高 1.6、深色模式跟随系统;PWA manifest + 图标。
- [通过] docker compose 仅含 db(postgres:16);`.env.example` 列全变量并注释。
- [通过] 空测试通过(Vitest 就绪;Playwright 移动视口配置就绪,冒烟用例待 dev server,
  见「真机验证步骤」)。
- [需真机] 手机访问显示壳页面且无横向滚动 —— 步骤:`pnpm dev` 后手机访问
  `http://<电脑IP>:3000/`,确认首页无左右滑动、文字不小于 17px。

### M1 验收自检
- [通过] zod schema(src/lib/schema/paper.ts)= §4.4 全部类型,含 StudentAnswer 与
  stripAnswers(硬约束 1,附泄漏测试)。
- [通过] Drizzle 表 = §9.3 全部 13 张表 + 首个迁移 drizzle/0000_init.sql。
- [通过] `pnpm seed` 幂等导入:本地真 PostgreSQL 16 实测连续执行两遍,
  计数恒为 1 试卷 / 6 大题 / 8 题组 / 43 小题 / 总分 100,无重复记录;断言内建于脚本。
- [通过] schema 对种子任意字段删改能报准确错误(测试:删 answer.accepted → 路径级报错)。
- [通过] 教师端只读页 `/teacher/papers/hubei-zsb-english-2025` 按 大题→题组→小题
  展示整卷(含答案与解析),仅 teacher/admin 会话可见。
- [需真机] 教师页人工核对试卷内容与原卷一致 —— 步骤:dev-login 为 teacher 后访问上述路径,
  抽查每大题首末两题的题面与答案。

### 未决问题
- Playwright 冒烟需要运行中的 dev server,CI 端到端将在 M2 接入(当前用例在无
  `E2E_BASE_URL` 时跳过)。
- 种子中主观题参考答案/评分细则为 AI 整理(SPEC 附录 A),发布前需教师核定
  (试卷状态已按种子保持 draft)。

### 下一步
M2:判分引擎(§5.1–5.2 + ≥60 表驱动用例)、作答骨架(AnswerBar/EnglishInput/六题型
渲染器/答题卡)、本地保存与同步队列、attempts/responses/check 接口。
