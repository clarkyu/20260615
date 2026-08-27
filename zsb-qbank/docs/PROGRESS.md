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

## M2 判分引擎与练习模式(2026-08-27)

### M2 验收自检
- [通过] §5.1 规范化流水线 + §5.2 客观题判分为 `src/lib/grading/` 纯函数
  (normalize.ts / objective.ts),不碰数据库与网络;97 个表驱动用例
  (SPEC 要求 ≥60),覆盖全角/大小写/首尾标点/多空格/弯引号/词数超限/
  正则答案/Levenshtein 容错(仅 fuzzy 开启时)/reorder 标点附着与多参考答案/多选全对制。
- [通过] 种子试卷 32 个客观题「参考答案必得满分」逐题守卫
  (tests/grading/seed-full-marks.test.ts;reorder 用穷举排列反推下标序列),
  防答案键与判分规则脱节(硬约束 2)。
- [通过] 接口:`POST /api/attempts`(practice 开卷)、`GET /api/attempts/:id`
  (整卷下发,经 stripAssembledAnswers 剥答案——curl 实测 43 题无一携带
  answer/explanation 字段)、`PUT …/responses`(zod 校验、跨卷 itemId 过滤、
  clientUpdatedAt 新者胜、已交卷 409)、`POST …/check`(exam 模式 403;客观题
  即时判分落库 + 常见错答计数;主观题返回 pending 等 M4)。
- [通过] 作答骨架(§7):顶栏(大题名/进度/同步状态点/答题卡)+ 按题组分派的
  六种渲染器(cloze 内嵌空位芯片、reading_fill 与 reading_qa 上下分栏 30/50/70
  吸附 + 全屏原文、reorder 点选词块、汉译英 zh 卡 + 空位 + 词数、writing 可折叠
  要求 + 自查 + 实时词数)+ 底栏(上一组/对答案/下一组)。
- [通过] 作答条(§7.2):visualViewport 贴键盘上沿、题号 + 提示词 + 「只填一词/
  不超过 N 词」规则、超词红框、Enter=下一空(末空=确定)、‹ › 循环切空并滚动定位。
- [通过] `<EnglishInput>`/`<EnglishTextarea>` 唯一英文输入组件:autoCapitalize/
  autoCorrect/spellCheck/autoComplete 固定关闭、字号 16px(硬约束 3)。
- [通过] 离线优先(硬约束 7):作答先写 IndexedDB(Dexie)再进同步队列;
  3 秒间隔 + 页面隐藏 + 网络恢复触发批量 PUT;失败指数退避 6s→60s;
  重开页面本地恢复并与服务端按 clientUpdatedAt 合并;顶栏 已保存/保存中/离线 圆点。
- [通过] 本地真浏览器冒烟(390×844,dev server + PG16):学生登录→首页开卷→
  填空(1=biggest 判对、含解析)→连词成句(点选拼句判对,词块标点不参与比较)→
  答题卡 6 大题 43 小题跳转(跳作文/跳阅读填词均正确)→刷新后作答与计数恢复。
- [通过] 门禁:`pnpm lint`、`npx tsc --noEmit`、`pnpm test`(97)、`pnpm build`
  全绿;/play 首屏 First Load JS 144 kB < 200 KB(硬约束 5)。
- [需真机] iOS 微信与 Android 微信各完成一次整卷练习 —— 步骤:`pnpm dev` 后
  手机微信打开 `http://<电脑IP>:3000/`,学生身份登录→开始练习→逐组作答并
  「对答案」→整卷走完;期间确认键盘弹出时作答条贴键盘、无横向滚动。
- [需真机] 输入 `snows` 不被改写 —— 步骤:任一填空输入 snows,确认不被自动
  纠正为 snow/knows、首字母不被大写。
- [需真机] 刷新与切出微信后作答仍在 —— 步骤:作答数题→下拉刷新页面、
  切出微信再切回,确认已填内容与「已答 n/43」不变;飞行模式下作答,顶栏变
  「离线,已存本机」,恢复网络后自动转「已保存」。

### 未决问题
- 主观题(阅读问答/英译汉/作文)练习模式「对答案」返回「AI 评分中(M4 接入)」;
  M4 落地前学生只能对照参考答案自评(参考答案在判分反馈中不下发主观题,
  仅客观题反馈携带)。
- 连词成句展示行对含句中标点的词块(如「Can you ?」)的拼句预览排版仍有小瑕疵
  (显示为「Can you? tell me your plan」),不影响判分;M3 顺手打磨。
- CI 端到端(Playwright + 可复位测试库)计划 M3 接入(docs/DECISIONS.md D8)。

### 下一步
M3:考试模式(服务端 deadline_at 计时、交卷锁定、成绩页)+ assignment 任务发布/
作答入口 + CI e2e。
