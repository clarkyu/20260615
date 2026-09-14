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

## M4 AI 评分与解析(2026-09-13)

### M4 验收自检
- [通过] ai_jobs 工作线程:instrumentation 每 2 秒消费(每轮领取 ≤AI_BATCH 条、AI_CONCURRENCY
  并发执行,防重入,FOR UPDATE SKIP LOCKED 多实例安全),失败按 attempts×5 秒退避、最多 3 次;
  running 超过 5 分钟视为进程崩溃遗留自动回收;未预期异常放回队列不留悬挂;与逾期清扫同进程(D14)。
- [通过] 三类主观题评分提示词(short_answer / translate_e2c / writing)+ 汉译英兜底 +
  解析生成,共 5 份 prompts/*.md(D15);用户消息按 §5.3 固定字段拼装:题型、题目、参考
  答案、要点、评分细则、满分、学生答案、材料原文(仅阅读问答),表驱动测试守卫字段齐全。
- [通过] 服务端硬性约束(§5.3):score 夹在 0..满分并按 0.5 步进;作文低于 minWords 按
  rubric 扣「字数」维度并记 issue;confidence < 0.6 或调用失败/结构不合法 → needs_review;
  AI 与教师评分分别存于 grade_detail(ai / 后续 teacher);37 个表驱动用例。
- [通过] 交卷后 60 秒内主观题有 AI 分数与中文评语:交卷即入队,线程 2 秒节拍领取,单次调用
  30 秒超时;集成用例(真库 + 假 AI)一轮即出分、评语落 responses.feedback、attempt 总分
  重算。真接口时延取决于所配模型(需真机/真环境验收,见下)。
- [通过] AI 不可用时系统不崩溃且题目标记待评:AI_BASE_URL/AI_API_KEY/AI_MODEL_GRADING
  任一缺失即视为未配置,任务直接 failed(ai_not_configured)、题目 needs_review、成绩页显示
  「待老师评分」;汉译英兜底记 0 + needs_review(§5.2);集成用例覆盖。
- [通过] 同一答案不重复计费:ai_grade_cache(item_id + 规范化答案 + 提示词版本的 SHA-256)
  入队命中即直接写回、不入队;执行前再查一次缓存(先后入队的相同答案只计费一次);同 response
  同快照已有未完成任务时复用。送评答案在入队时快照进 payload,缓存键与快照一致;写回前核对
  学生答案未变且不是教师终评,否则作废(superseded)——练习中改答不会污染缓存(D17)。
- [通过] translate_c2e_fill 兜底:词表未命中且非空/非超词 → 入队 c2e_fallback,AI 只判「可接受
  与否」——可接受满分记 correct,否则 0 分记 wrong 并此时才计入常见错答(§5.2 二值);练习与交卷
  两条路径都接。AI 判可接受的答案连同题号留在 ai_jobs.result,供 M5 教师端采纳为候选 accepted
  (自动写回 items.answer 不做——参考答案是内容模型的事实来源,须教师确认)。
- [通过] 解析生成:POST /api/teacher/items/:id/explain 入队 explain 任务,GET /api/teacher/
  jobs/:id 取 {explanation, knowledgeTags, difficulty, commonMistakes} 草稿,不改小题
  (教师在 M5 导入向导确认后写回)。
- [通过] 成本日志:ai_jobs.result.usage(tokens/latency/model)+ 控制台一行,不含学生内容(D13)。
- [通过] 学生端:练习「对答案」后主观题显示「AI 评分中」,每 3 秒轮询 feedback 接口、最长
  90 秒(各组各起一轮互不打断,卸载统一停止,写回前核对 attemptId),评完显示分数 + 评语 +
  参考答案 + 解析 + 常见错答(客观题答错时,§5.4);超时提示「回头再点一次对答案」;成绩页新增
  「待老师评分 / AI 已评分」状态,待评题数计入总分说明(D16)。
- [通过] 考试未发布(§9.4):result 对主观题只显示待评、不计总分,评语一律不下发;GET attempt
  不再带分数/评语;练习或 released 后才全量可见(maskUnreleased 纯函数有测试)。
- [通过] 防注入与限速(§9.5):学生答案用 <student_answer> 标签包裹并在提示词声明标签内指令无效;
  服务端启发式命中即强制教师复核且不入缓存;check / explain 按用户限速(60、30 次/分钟)。
- [通过] 门禁:lint、tsc、单测(含 15 条真库集成用例,CI 已改为 migrate/seed 后跑 test)、
  build 全绿;新增迁移 drizzle/0001(ai_grade_cache)。dev 模式下 instrumentation 的 edge 编译
  不再因 pg/fs 失败(next.config 边缘别名,D15)。
- [评审] 合并前跑了 6 视角评审 + 逐条 3 票反驳核实(150 个代理):确认 32 条(0 blocker),全部
  修复——队列悬挂回收、快照/缓存一致、执行前查缓存、教师终评保护、有界并发、交卷原子化、考试
  未发布屏蔽、提示词去锚定/防注入/二值兜底/非英文作答、作文字数封顶去双扣、轮询生命周期、常见
  错答、限速与 uuid 校验、测试隔离与覆盖。
- [需真环境] 交卷后 60 秒内出分 —— 步骤:.env 配 AI_BASE_URL/AI_API_KEY/AI_MODEL_GRADING,
  `pnpm dev`;学生开一场模考,主观题作答后交卷;成绩页 1 分钟内刷新应见 27–36、43 题
  有分数与评语;服务日志有「[ai] grade job=… tokens=…」。
- [需真环境] 待评分流 —— 步骤:故意把 AI_API_KEY 改错,重复上一步;成绩页应显示「待老师评分」
  而非一直转圈;日志「failed after 1 attempts」(401 非瞬时错误不重试,立即分流)。
- [需真环境] 班级规模吞吐 —— 步骤:40 人同一 deadline 到时自动交卷,观察日志「队列一轮」节奏;
  默认 AI_BATCH=8、AI_CONCURRENCY=4,单次调用 3–5 秒时约 11 题×40 人 ≈ 440 条需 6–10 分钟,
  「60 秒内出分」对单人交卷成立、对整班需调大并发(受模型限流约束)——PROGRESS 记实测值。

### 未决问题
- 教师复核队列(GET /api/teacher/grading/queue、PUT responses/:id/grade)与成绩发布
  (release)在 M5;此前 needs_review 的题在成绩页显示「待老师评分」。
- 提示词质量需真模型上对照教师评分抽样校准(M5 学情页可加「AI 分 vs 教师分」对比)。
- 常见错答(§5.4)前五展示在 M5 教师端;数据已在 wrong_answers 表累积。

### 下一步
M5:教师端(班级与加入码、任务发布、批改队列、学情分析与导出、docx 导入向导)。

## M5 教师端(2026-09-14)

### M5 验收自检
- [通过] 班级与加入码(§8):建班生成六位加入码(去掉 0/O/1/I 的字符集,唯一索引冲突重试);学生首页输入
  加入码入班(幂等、限速 20 次/分钟防猜码);班级页显示加入码与人数、成员名单与任务;一个学生可在多个班。
- [通过] 组卷与发布(§8):任务表单选试卷(整卷或勾选小题——题单来自教师接口,按大题全选 / 逐题勾选,
  实时显示已选题数与分值)、班级、模式(练习 / 考试)、开放与截止、考试时长(默认试卷时长)、解析可见、
  成绩发布方式(手动 / 交卷即发布)、考试是否允许重考。服务端校验:班级归属、小题属于试卷、截止晚于开放。
- [通过] 任务作答规则(§6 / §9.4 / D9 收口):POST /api/attempts { assignmentId } 校验成员与开放期;考试
  deadline = min(now + 时长, 截止);未交续答同一 attempt;任务考试默认不可重做(allowRetake 放开);练习
  可再练。子集组卷贯通作答页 / 对答案 / 反馈 / 交卷 / 成绩页——只装配与判分任务范围内小题,满分 = 所选分值和;
  showExplanation=false 时出分不带解析;on_submit 交卷即 released。真库集成用例 6 组覆盖。
- [通过] 学生端任务入口(§9.4):首页「我的任务」列所在班级任务(班级、模式、题数、时长、开始 / 截止、状态),
  按状态给「开始 / 继续 / 看成绩 / 再练一次」,未开始 / 已截止置灰;下方仍保留自由练习。
- [通过] 成绩发布(§6):任务详情页名单(每人最近作答状态 / 分数 / 交卷时间)+ 一键发布整任务或单份;
  发布后学生成绩页可见参考答案、解析、AI / 教师分数(M3 的 revealAnswers 门控不变)。
- [通过] 批改队列(§8):列出 needs_review 与抽查的主观题作答(范围 = 本教师班级任务 + 无任务的自由练习,
  D20),按任务 / 小题筛选;同一小题批量浏览时按学生答案相似度排序(词级 + 字符二元组 Dice,最近邻链,
  纯函数有测试);每行展示学生答案、AI 分 / 置信 / 命中要点 / 问题 / 评语、参考答案与细则;教师改分或一键
  确认 AI 分 → gradeSource=teacher 终评(AI 分保留在 grade_detail.ai 供比对)、needsReview 清零、总分重算;
  分数夹到 0..满分并按 0.5 步进;越权 404。集成用例 4 组。
- [通过] 学情分析(§8)任务维度:每题正确率热力表(客观 = 答对 ÷ 已交;主观 = 平均分 ÷ 满分)、每题前五常见
  错答(本任务作答规范化统计)、分大题得分率、班级分布(按满分百分比五档 + 均值 / 中位 / 极值)、学生 × 小题
  矩阵;学生维度:各次任务成绩、题型得分率、错题数、复习到期数(review_cards,M6 填数)。纯函数 18 例。
- [未通过 · 说明] 「每题中位用时」需要客户端逐题计时埋点,首期未采集,统计页明示;M6 训练模式接入作答计时后补。
- [通过] CSV 导出:UTF-8 BOM + CRLF,字段引号转义,公式注入防护(= + - @ 开头加撇号),RFC 5987 中文文件名;
  内容 = 学生 × 小题矩阵 + 每题统计(含常见错答五列)+ 分大题 + 分布。Excel 直接打开中文不乱码(BOM 已验证
  于导出字节流;真机 Excel 打开为需真环境项,见下)。
- [通过] docx 导入向导(§8 / 附录 B):上传 → mammoth → HTML → turndown → Markdown(≥2 连续空格换成不间断
  空格以保住空位)→ 规则切分 → AI 逐题组补答案 / 解析 / 标签 / 难度(prompts/parse-paper.md;文末参考答案
  自动截出喂给模型)→ zod 校验 → 校对页(左原文 / 右表单,规则与 AI 拿不准的地方按路径标红)→ 保存。
  附录 B 全部陷阱对仓库附带的 2025 docx 有断言:大题序号 / 标点混用与「每题 N 分 / 共 N 题」解析;第 16 题
  `16.to` 无空格;第 17 题被转成列表项 → 按序推断并标 numberInferred(校对页标红);第 18 题无编号空格空位;
  短文填空多空格数字 + 紧跟提示词;汉译英下划线空位与句末括号提示词;Passage 标题夹粗体碎片;第 23、24 题
  一行两空;词块带标点、以 / 分隔;作文中文条目要点 + 正文里的「不少于 40 词」。2025 docx 切出 6 大题 /
  8 题组 / 43 小题 / 总分 100,与种子一致;2026 校订版 docx 亦切出 43 题且文末参考答案被识别。
- [通过] 整卷 / 小题写入:PUT /api/teacher/papers/:id(zod 唯一事实来源,问题按路径回显;已有作答记录的
  试卷拒绝整卷重建 409,避免小题换 id 令作答与任务失联);PATCH 状态流转;PUT /api/teacher/items/:id
  合并后整题过 itemSchema。
- [通过] 门禁:lint、tsc、单测 286 例(含真库集成)、next build 全绿;本地 dev server 全链路冒烟(建班 → 发布
  子集任务 → 学生入班 → 开始 / 续答 → 交卷 → 教师名单 / 发布 → 学情 / CSV → 批改页;docx 上传 → 解析任务
  → 保存 → 发布状态 → 小题编辑)。
- [评审] 合并前跑了 7 视角评审(任务规则 / 授权与滥用 / 批改与统计 / 导入规则 / 客户端 / 数据库 / SPEC 对照)
  得 53 条原始发现,逐条核实后修复 40 条(其余为重复或不成立):练习任务补「完成」提交路径(此前老师端
  名单 / 学情永远 0 已交)、「允许重考」补学生端「再考一次」入口、整卷重建同样拒绝被勾选小题任务引用的试卷、
  开始作答改为事务 + 咨询锁(双击不再建两份)、教师页与学生卡片时间统一按北京时间(容器 UTC 且水合一致)、
  小题编辑作废 ai_grade_cache / wrong_answers 并重算试卷满分、docx 上传先看 content-length 与 zip 中央目录
  解压总量(zip bomb)、教师写接口按用户限速 120/分钟(§9.5)、路径 id 先验 uuid(畸形 id 404 而非 500)、
  学情分布排除有待评小题的学生并单独计数、学生维度得分率按范围内全部小题(未答计 0)、分大题得分率用未取整均值、
  相似度排序预计算多重集(500 条毫秒级)且单字符 / 空答案不再判同、「确认 AI 分」只认真正的 AI 分、练习
  「对答案」不覆盖教师终评、总分重算改单条语句、名单 / 学情取「代表性作答」(交过卷再练一次丢半路仍显示成绩)、
  批改队列上限 500 并提示截断、学生维度 CSV 导出、导入向导:题号重复按路径报错(此前入库 500)、题型识别
  不出仍切占位小题、建议 id 撞已有试卷自动加后缀、句首字母不再被吞、翻译题缺句标红、三位数题号、重新上传
  不再轮询旧任务、列表字段回车不再被吞、JSON / 数字字段错误可见、顶层问题可见、保存失败不抹掉规则标红、
  汉译英摘要读 zh 字段、批改链接直达抽查范围、教师端不再受学生端 576px 列宽限制(学生路由组独立布局)、
  新增中文文案全角标点。未采纳:全站 Origin 校验(M3 起学生写接口也未做,留 M7 统一加);「每题中位用时」
  仍待埋点。新增单测 14 例(总 300)。
- [需真环境] 「用附带 docx 从上传到发布不超过 30 分钟」:配好 AI_MODEL_AUTHORING 后,教师端「导入」上传
  seed/raw/001;预期 10–60 秒得到草稿(6 次 AI 调用,每题组一次),校对页标红处应只有第 17 题题号、第 43 题
  题号与分值、以及 AI 低置信度的题;逐题核对后「保存试卷」→「发布任务」。PROGRESS 记实测用时。
- [需真环境] CSV 在 Excel 中打开:任务学情页「导出 CSV」→ Windows Excel 双击打开,首列「学生」与中文题型
  应无乱码;若用 WPS 亦同。
- [需真机] 学生手机端:首页输入加入码 → 出现任务卡 → 开始考试 → 交卷 → 老师发布后看成绩(单列 / 44px 按钮
  / 微信内置浏览器)。

### 未决问题
- SPEC §9.5「写接口校验 Origin」全站未做(学生与教师写接口都靠 SameSite=Lax),M7 上线前统一加。
- 学生自由练习仍列出全部试卷(D7 的收紧延后到 M7:先由教师在试卷页把种子卷置为已发布,再收紧为仅见
  published,避免部署即断练习入口与 e2e)。
- AI 结构化的答案准确度需真模型抽样;校对页对 confidence < 0.6 已标红,但模型对 fill 类题给错答案而自信时
  只能靠教师核对——建议先用文末附参考答案的 docx。
- 题库管理(§8:按试卷 / 大题 / 题型 / 标签筛选、小题停用、accepted 候选采纳)只做了小题编辑接口与整卷
  查看,筛选 UI 与候选采纳留待 M6/M7。

### 下一步
M6:训练模式(按题型 / 标签抽题、脚手架、错题与复习卡、作答计时以补齐「每题中位用时」)。

## M6 训练模式(2026-09-14)

### M6 验收自检
- [通过] 错题本与复习卡(§6 / M6):训练里答错即建复习卡,次日到期;答对沿 1、3、7、14、30 天阶梯拉长,
  答错回到 1 天并记一次遗忘(错题重置);阶梯走完再答对视为掌握。纯函数 `lib/training/srs.ts` 表驱动测试。
  「错题在次日出现在今日复习」有真库用例:今天答错 → 今天的复习列表没有它 → 明天有,且「复习」抽题排在最前。
- [通过] 专项训练抽题:GET /api/training/next?mode=targeted&type=&tags= 按题型(填词 / 汉译英 / 连词成句)
  与知识点(数组交集)抽题,只抽 status=approved 的小题;排序先没练过的、再正确率低的、再练得少的,同档随机;
  返回只剥离了答案与干扰项的内容,默认带 contextSnippet(阅读填词没有片段的用题组框架里的所在句兜底),
  材料与框架一并返回供「展开全文」。
- [通过] 每日任务:今日到期复习(≤ 20)+ 10 道新题(优先最薄弱题型);进度按北京时间当天的训练记录算
  (每人每天一份 mode=training 的 attempt,作答时记下这次是复习还是新题)。首页有「每日训练」入口卡。
- [通过] 三级脚手架(§6):一级选词块(正确答案 + 干扰变形,顺序稳定)、二级首字母 + 字母数掩码(单字母答案
  只给字母数)、三级自由拼写;答对升级、答错降级、三级连对两次永久关闭;没有干扰项时一级退化为二级。状态存
  training_progress(新迁移 drizzle/0002)。纯函数 `lib/training/scaffold.ts` 表驱动测试 + 真库用例
  (连对四次关闭)。
- [通过] 变式题生成入草稿:POST /api/teacher/items/generate { itemId, mode: variants } → ai_jobs kind=generate,
  模型返回过 zod + 自检(填空片段含 {{1}}、汉译英框架含 {{blank}}、词块能拼出答案、题型与原题一致)后以
  status=draft、origin=ai 写入原题所在题组(题号从 1001 起);教师在试卷页「待审核变式」通过 / 删除。
  「不经审核不会被抽到」有真库用例:草稿不进 assemblePaper、不进训练抽题;通过后才被抽到。mode=distractors
  生成一级脚手架干扰项(清洗掉与答案重合的、去重、最多 3 个),教师采纳后写入 content.distractors。
- [通过] 接口:GET /api/training/next、POST /api/training/answer(即判 + 更新脚手架 / 复习卡 / 常见错答;
  汉译英未命中交 AI 兜底并返回 pending,客户端轮询 feedback 接口)、GET /api/review、GET /api/me/stats、
  GET /api/teacher/items?paperId=&status=、DELETE /api/teacher/items/:id(仅 AI 草稿)。
- [通过] 学生端 /train:训练首页(今日任务进度条、复习错题、专项训练题型 / 知识点入口、题型得分率)+ 训练
  会话(逐题推送、即时反馈卡、复习间隔与脚手架变化提示、一组做完自动抓下一组、无题时收尾)。单列、44px、
  EnglishInput、全角标点。
- [通过] 门禁:lint、tsc、单测 317 例(含真库集成 4 组)、next build、e2e 全绿。
- [需真环境] 变式题与干扰项的质量:配好 AI_MODEL_AUTHORING,在试卷页对第 1、37 题各点一次「生成干扰项」
  与「生成 3 道变式」,查看采纳 / 审核体验;通过一道变式后到学生端专项训练按其知识点抽题应能抽到。
- [需真机] 学生手机:首页「每日训练」→ 开始今日任务 → 一级选词块(需教师先采纳干扰项,否则从二级开始)→
  答错 → 明日「复习错题」出现该题;汉译英答非词表答案 → 「AI 复核中」→ 3 秒内出结果。

### 未决问题
- 「每题中位用时」仍未采集(训练与练习均未埋点),M7 前评估是否加 responses.timeSpentMs。
- 训练里汉译英走 AI 兜底时,复习卡与脚手架按即时的客观判定(未命中 = 错)更新;AI 判可接受不回溯改卡
  (D29)。
- 教师端题库管理的筛选 UI、accepted 候选采纳(来自 AI 兜底)仍未做,M7 前视工作量补。

### 下一步
M7:上线(Dockerfile 与 compose、HTTPS、备份脚本、性能预算核查、真机验收矩阵、RUNBOOK;顺带收紧 D7
学生仅见 published 试卷、全站 Origin 校验)。

## M7 上线(2026-09-14)

### M7 验收自检
- [通过] Dockerfile 与 compose(§9.6):多阶段构建(deps → builder → runner)产出 standalone 镜像,
  非 root 运行、tini 收尸、`HEALTHCHECK` 打 `/api/health`;`docker-compose.yml` 定义 `db`(数据卷持久化、
  healthcheck)、`app`(只监听 `127.0.0.1:3000`,依赖 db healthy)、`tools`(带 devDependencies 的构建层
  镜像,`docker compose run --rm tools pnpm db:migrate / pnpm seed`——运行镜像精简后没有 tsx)。
  `docker compose config` 校验通过。
  · 本仓库外层还有一份 lockfile,Next 会把工作区根推断到宿主仓库、standalone 产物多嵌一层目录;
  已在 `next.config.ts` 钉住 `outputFileTracingRoot`,产物布局在本地与镜像里一致(D32)。
- [通过] 运行产物验证(等价于镜像内运行):把 `.next/standalone` + `.next/static` + `public` + prompts
  按 Dockerfile 的布局拼好后 `node server.js` 起服务——健康检查、首页 / 训练页 / 教师页(未登录 307)、
  `/api/time`、manifest、跨站 POST 403、HTML `cache-control: no-cache`、AI 线程启动日志全部正常。
- [未跑 · 说明] `docker build` 实机构建未执行:沙箱内有 docker 客户端但无 daemon(D4)。首次
  `docker compose up -d --build` 即为该项验收,RUNBOOK 已写明命令与自测点。
- [通过] HTTPS:RUNBOOK 给出 Caddy 与 nginx 两份反代配置(含 `X-Forwarded-Host` / `X-Forwarded-Proto`
  ——写接口的 Origin 校验依赖它、`client_max_body_size 12m`、`proxy_read_timeout 65s`);app 不直接对外。
- [通过] 备份脚本:`scripts/backup.sh` 用 `pg_dump -Fc` 落到 `BACKUP_DIR`(默认 ./backups)并清理
  `KEEP_DAYS`(默认 14)天以前的文件,含 cron 示例;`scripts/restore.sh` 用 `pg_restore --clean --if-exists`
  恢复到指定库并打印 papers / items / attempts / responses 行数。两者 `bash -n` 通过。
- [通过] 「备份脚本可恢复到空库」本地实测:对 55432 的开发库备份 → `createdb zsb_restore_test` →
  恢复 → 行数与源库一致(见下「本地恢复演练」)。
- [通过] 性能预算:新增 `scripts/check-budget.ts`(`pnpm budget`),从 `app-build-manifest.json` 取各路由
  首屏 JS 并逐个 gzip 求和,学生端四个路由(/、/play/[attemptId]、/result/[attemptId]、/train)对 200 KB
  预算核查;实测 106.5 / 143.1 / 105.4 / 108.0 KB,全部在预算内。已接进 CI(build 之后)。
- [通过] §7.7 适配收口:HTML `Cache-Control: no-cache`(M4 起);考试页 `overscroll-behavior: none`
  禁下拉刷新;新增 `GET /api/time`,作答页在 `visibilitychange` / `pageshow` 时用服务端时间重新校准
  倒计时(iOS 微信切后台会冻结定时器;计时仍以服务端 deadline_at 为准)。
- [通过] §9.5 写接口 Origin 校验:新增 `src/middleware.ts` + 纯函数 `lib/http/origin.ts`,对 /api 下所有
  非 GET/HEAD/OPTIONS 请求校验 Origin(同源或 `APP_ORIGIN` 白名单),跨站一律 403;没有 Origin 的
  非浏览器请求放行(不构成 CSRF)。14 条表驱动用例 + 生产构建实测(跨站 POST 403、同源 200、GET 不拦)。
- [通过] D7 收紧:学生端「自由练习」只列 `status=published` 的试卷,`POST /api/attempts { paperId }`
  对学生也只放行已发布卷(任务作答走 assignmentId 分支,不受影响);教师试卷页新增发布 / 撤回 / 归档
  开关。种子卷状态改为 published(答案已被判分用例覆盖),新导入卷仍默认草稿。实测:置为草稿后学生
  首页 0 张卡片、开卷 404;发布后恢复正常。
- [通过] 门禁:lint、tsc、单测 331 例、build、`pnpm budget`、移动视口 e2e 4/4 全绿。
- [需真机] §7.7 四台真机验收矩阵(iOS 微信 / iOS Safari / Android 微信 / Android Chrome):
  逐项步骤与记录表见 `docs/RUNBOOK.md` 三、五节。其中「切后台 2 分钟再回来倒计时跳到正确值」与
  「考试页下拉不刷新」是本里程碑新增的检查点。

### 本地恢复演练(2026-09-14,已实跑)
```
BACKUP_DIR=… ./scripts/backup.sh          # → zsb-20260914-102839.dump(68K)
createdb -p 55432 zsb_restore_test        # 空库
./scripts/restore.sh <dump> postgres://zsb@127.0.0.1:55432/zsb_restore_test
# 恢复后:papers=2 items=86 attempts=15 responses=12,与源库逐项一致
```

### 未决问题
- Casdoor OIDC 仍未接入(D2):生产先关 `AUTH_DEV_LOGIN`,由 clark 用开发登录建教师账号,学生用加入码进班。
- Serwist / Service Worker 仍未接入(D3):断网续答靠 IndexedDB + 同步队列,首次打开仍需网络。
- 「每题中位用时」仍无埋点;多副本部署时 AI 队列线程会重复起(领取安全但无意义),横向扩容前先拆进程。

### 下一步
SPEC §10 的七个里程碑到此全部完成。后续按 clark 的实际使用反馈迭代:优先补 Casdoor 登录与
Service Worker,再看题库管理筛选 UI 与 accepted 候选采纳。
