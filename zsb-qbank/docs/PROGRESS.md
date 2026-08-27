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

## M3 考试模式(2026-08-27)

### M3 验收自检
- [通过] attempt 生命周期:开考(POST /api/attempts mode=exam,服务端设
  deadlineAt = now + 试卷 durationMinutes 并返回)→ 作答(同 M2 离线同步链路)→
  交卷(POST …/submit,幂等)→ 成绩(GET …/result)。自由模考断线续答:未交的
  同卷考试续用同一 attempt、倒计时不重置(curl 实测 resumed:true 返回同 id;
  已交的不挡新开——docs/DECISIONS.md D9)。
- [通过] 服务端权威倒计时(硬约束 6):GET attempt 返回 deadlineAt + serverNow,
  客户端用时钟偏移校正后只做显示;顶栏 mono 倒计时,剩 5 分钟变红并一次性弹提醒,
  到 0 自动 冲队列 → 交卷 → 进成绩页。
- [通过] 截止 + 60 秒宽限(§9.5):宽限内仍收保存(弱网最后一批同步);过宽限
  PUT responses 返回 409 deadline_passed(curl 实测);表驱动边界用例 3 条。
- [通过] 逾期未交自动提交:instrumentation 每 60 秒清扫 + GET attempt/result 惰性
  兜底(D10)。curl 实测:回拨 deadline 后 GET 即变 submitted,result 标
  autoSubmitted、43 题按 empty 0 分出分;定时线程另实测——插入逾期 attempt 后
  60 秒内被清扫为 submitted,服务日志见「[sweep] 自动交卷 1 份逾期考试」。
- [通过] 交卷确认(§7.4):二次确认框列出未作答题数;失败保留本地数据、可重试
  (「答案已存在手机上,不会丢」)。考试模式无「对答案」按钮,check 接口 403。
- [通过] 成绩页(/result/[attemptId]):总分 + 分大题小计(得分/满分/待评数)+
  逐题色块(对/错/待评/未答),点开看 我的答案/得分;主观题已答标「等 AI 评分」
  (M4 接入)。**未发布的考试不下发参考答案与解析**(revealAnswers 纯函数 +
  e2e 断言 + curl 全文检查无 accepted 字段);练习模式 result 全量可见。
- [通过] 判分复用 src/lib/grading 纯函数(硬约束 2),交卷不开容错;新增
  deadline/aggregate 纯函数 17 用例,共 114 测试全绿。
- [通过] e2e 入 CI(D11):模考闭环(登录→开卷→倒计时可见→无「对答案」→作答→
  确认框列 42 题未答→交卷→成绩页 2/20 分→未发布无参考答案)+ 首页无横向滚动,
  iPhone 13 / Pixel 5 双视口对 next start 真服务本地全过;zsb-ci 增 e2e 步骤。
- [通过] 门禁:pnpm lint、tsc --noEmit、pnpm test(114)、pnpm build 全绿;
  /play 首屏 146 kB、/result 108 kB(< 200 KB,硬约束 5)。
- [需真机] 120 分钟倒计时与服务端一致 —— 步骤:手机开一场模考,对照电脑上
  另一登录端(或 result 接口 deadlineAt),改手机系统时间 ±10 分钟,确认页面
  倒计时不受本机时间影响(刷新后仍按服务端算)。
- [需真机] 断网 5 分钟后恢复不丢答案 —— 步骤:模考中作答数题→开飞行模式 5 分钟
  →继续作答(顶栏变「离线,已存本机」)→关飞行模式→顶栏回「已保存」→交卷,
  成绩页里断网期间的作答都在。
- [需真机] 到时自动交卷 —— 步骤:(可让老师把某场 deadline 改近)等倒计时到 0,
  页面自动进成绩页;或关页面等 2 分钟后重进,直接落在成绩页且标「到时自动交卷」。

### 未决问题
- 成绩页主观题在 M4 前始终「等 AI 评分」;总分只含客观题(页面已注明会更新)。
- 教师发布成绩(released 流转)、任务考试(assignment)与不可重做授权在 M5/M6。
- sweep 线程与 M4 的 ai_jobs 消费循环合并为一个后台 worker(D10 预留)。

### 下一步
M4:AI 评分与解析(ai_jobs 工作线程、三类主观题评分提示词、translate_c2e_fill
兜底、needs_review 分流、成本日志)。
