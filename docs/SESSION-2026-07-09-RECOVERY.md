# 会话恢复档 · 2026-07-09（评阅收尾 + 待批转正 + 雨课堂方案）

> 目的:下次会话完整恢复本次上下文。本次跨三条线——(A) 期末环节2 改判 + 评阅队列全清、
> (B) 「所有待批转正、全部采用 AI 批阅」、(C) 新功能「雨课堂课堂表现 → 平时成绩」方案二次深挖。
> **恢复时先读本档 §2「进行中/待办」——那是唯一还没收尾的活。**
> 相关旧档:`docs/GRADING-BACKLOG-2026-07.md`(评阅运维总账)、`docs/OPERATIONS.md`§6(维护端点按钮)。

---

## §1 本次已完成(A + B 线)

### 期末考核 环节2 改判(合格文本 → 高分)· ✅
clark:「学生选课文背诵、上批多为低分(无参照文本);现改为:只要提交了合格文本,均按课文对待给高分。」
- `set-phase-rubric`(schoolId=1, title=`期末考核：2025-2026-2`, order=2)落**从宽 rubric**:合格书面文本→90-100,
  只对空白/极短/乱码/无关给低分,满分100。落到全部班级的 order=2(item=writing, refsrc=null)。
- `regrade-phase`(同上, apply)重判 **456 份**非老师改分的 writing;DeepSeek 文本判分,`restored:0`(writing 无感知)。
- **结果:avg_final 94.0、438/464 ≥90(94%)、<60 仅 13(真空白/乱码)、0 待评、5 份老师改分不动。** 已达标。

### PR #434(已合并部署)· drain 按 kind 排空 + 关单日花费护栏
- **根因**:`claimAndRunDue` 严格按 `nextAttemptAt` FIFO、**无按类型公平**。逐句(shadow, Gemini, 早入队)排在
  环节2 writing(DeepSeek, 晚入队)前面,writing 被饿死(卡 61/400、30+ 分零进展)。多开 drain 只多啃逐句。
  **不是** $50 花费护栏(当天才花 ~$32<$50);`spendSinceMicroUsd` 求和正确。
- **改**:`claimAndRunDue(prisma, limit, runner, kind?)` 加可选 kind;`/api/cron/drain` + `grading-drain.yml` 加
  可选 `kind`(submission/shadow/writing) 入参;`wrangler.jsonc` `GRADING_DAILY_CAP_USD="0"`(clark 要求关护栏)。
- 合并部署后用 `grading-drain kind=writing` **90 秒清空环节2 的 400 份**(writing DONE 61→461)。

### Gemini 花费为何涨得快(已向 clark 解释)
- 按 `AiUsageLog` 拆:**逐句(shadow)是花费炸弹**——07-08 才 157 次调用却 323 万输出 token($10.12);
  07-09 每次逐句 ~2-4.6 万输出 token,是普通感知(~840/次)的 25-55 倍。因每份逐句要逐句喂 Gemini 感知。
- 是**一次性补评积压尖峰**,非日常水位;排空后回落。writing/文本判分是 DeepSeek,$0 Gemini。

### 评阅队列全清 + 死信处理 · ✅
- 全部**可评**内容评完。`reconcile-graded-jobs`(schoolId=1, apply)把幽灵死信(已评出分但任务挂 FAILED)对成 DONE。
- **坏视频 sub 31723**:学生**桑杰巴珠**(2531324 班, 学号 80254006), `Native English 2000：2026 年 5 月…` **环节2**,
  错误 `Gemini 400 invalid argument`(视频本身损坏, AI 评不了)。clark 决定手动处理;它是幽灵死信、已 reconcile 成 DONE。
  → **仍需 clark 在评分页手动打分或让学生重录**(我这边无老师会话, 调不了 overrideScore)。
- **sub 38383**(6月逐句, Gemini 524 网关超时=瞬时): `requeue-shadow-grading`(6月 title, apply, dry-run targets=1)重排 → 正在评。

### PR #435(已合并, 部署进行中) · requeue-media 也捞纯音频
- **根因**:`requeueMediaGrading` 复用 `listMediaProbeTargets`(`videoKey:{not:null}` 只认视频)。**纯音频整段提交**
  (audioKey 有、videoKey 空)从没被任何重排端点覆盖(继逐句、写作之后第三类盲区)。
- **改**:新增 repo `listMediaGradeTargets`(状态同口径, 媒体键 `videoKey OR audioKey`, 两组 OR 用 AND 包);
  `requeueMediaGrading` 改用它;**probe 仍单用 `listMediaProbeTargets`**(要对 videoKey 发网络探活, 不能喂空)。
  `grading-backfill.test` 补音频用例。`npm test` 706 通过。

---

## §2 进行中 / 待办 —— 恢复后先做这个 ⚠️

### B 线收尾:「待批全部转正、全部采用 AI 批阅」
clark 指令:所有 needsReview(待批, 含 FLAGGED 防作弊)转正、采用 AI 分。已 `accept-ai-phase` apply **9 个环节**
(Native 5月 ord1/2、6月 ord1/2、期末 ord2/3/4、非正式 ord1/2), **~504 份有 AI 分的已定稿**。

**残留 43 份 needsReview 但无 AI 分——实测全都有录音(非坏行),`empty_no_media=0`,全部可评。clark 本要打缺省60,
但既然都能评,应评真分(更符合"全部采用AI批阅"、不亏学生):**

| 作业·环节 | 份数 | 媒体 | 待办 |
|---|---|---|---|
| 非正式作业 ord2 | 17(8 FLAGGED + 9 UPLOADED) | 视频 | `requeue-media-grading`(非正式作业, apply) 已发过一次(dry targets=17);drain kind=submission 已在评 |
| 非正式作业 ord1 | 25 | **音频** | **等 #435 部署好** → `requeue-media-grading`(非正式作业, apply)现在会捞到音频 → drain |
| Native 6月 ord1 | 1(=sub 38383) | 逐句 | 正在评, 自愈 |

**恢复步骤(#435 部署完成后)**:
1. `admin-call requeue-media-grading` payload `{"schoolId":1,"title":"非正式作业","apply":true}` → 现在覆盖音频+视频。
2. `grading-drain` `{"rounds":"25","kind":"submission"}` → 评出真分。
3. `accept-ai-phase` apply 两次:`{"schoolId":1,"title":"非正式作业","order":1,"apply":true}` 和 `order":2`。
4. 验证 d1-query:`SELECT count(*) FROM Submission s JOIN Phase p ON p.id=s.phaseId JOIN Assignment a ON a.id=p.assignmentId
   JOIN CourseOffering o ON o.id=a.offeringId WHERE o.schoolId=1 AND s.needsReview=1` → 应 → **0**(sub 38383 评完后)。
5. 坏视频 sub 31723 交回 clark 手动(见 §1)。

---

## §3 新功能「雨课堂课堂表现 → 平时成绩」· 方案 v3(尚未开工, 等 clark 拍板/合并顺序)

> 已对上传的 xlsx(班级 2531320)做**二次深挖 + 57 人真实数据模拟 + 对抗复核 workflow**。方案定稿要点如下。
> 上传文件路径:`/root/.claude/uploads/a3c70669-bc5f-5590-9ece-2c2fdd0ea6c8/eb18f99c-…2531320…18815000.xlsx`
> 分析脚本存:`…/scratchpad/xlsx_deep.py`(信号+对账+公式模拟)、`xlsx_analyze.py`、`xlsx_sessions.py`。

### 数据实况(已核实)
- 雨课堂导出:Sheet1=每生汇总(学号/姓名/课堂总分320/签到次数(开课15次)/到课率/弹幕总/投稿总),Sheet2-17=16 节明细。
- **57 唯一学生**;学号 80253218(张国婷)重复两行,按学号合并(签到 11+4=15、弹幕/投稿相加)。
- **课堂总分/320 不可用**(中位0、最大7、多数题"未批改")、**抢答全0**、观看页/公告全0 → 弃。
- **可靠信号 4 个**:考勤(到课/未到)、弹幕(逐节)、投稿(逐节)、**课堂答题**(12/16 节有题;
  「未答题」=没答,「未批改/字母/分数」=**答了**——上一版误把未批改当没参与, 已纠正)。
- **09-2026-05-06 节是重开课、不计分**:留一法+Sheet1 表头标题集只列 15 节+明细表 A1 带「（2）」后缀 三重印证。
  → **该节必须从所有信号分母统一剔除**(考勤 /15、弹幕/投稿/答题分母都剔 09)。
- 真实最低到课 13/15(86.7%);「最低27%」是重复学号赝象。考勤在本班几乎不区分人 → 区分度靠参与信号。

### 推荐公式(默认, 权重老师可调)
四信号各归一 0..1(全二值, 按"当天该功能是否开放"归一), 加权 → 平时分 0-100, 算术在 `lib/domain` 纯函数、可单测:
- 考勤率 = 到课节/15
- 弹幕率 = (开弹幕且本人当天≥1条)节 / 开弹幕节
- 投稿率 = 同理
- 答题率 = (有题且本人答过≥1题)节 / 有题节
- 某信号整学期没开 → 剔除、权重重归一
- **默认权重 考勤0.5 / 弹幕0.15 / 投稿0.15 / 答题0.2**(公式B);模拟 57 人:均值80.5、中位81.9、最低47.4、最高96.5、<60 三人。

### 对抗复核发现的**必改项**(上线前一定要落, 否则对 minors 会输申诉):
1. **加保底**:到课率≥80%(或≥12/15) ⇒ 平时成绩≥60。现公式满勤零参与只有 50-60,真实命中张斯彧15/15→59.2 不及格,
   家长面前无法辩护。config 显式开关 + 默认开 + 导入预览列出"被保底救起"名单。
2. **追溯适用**:规则 2026-07 才定, 数据是 03-06 行为(学生不知弹幕/答题会计分)。追溯学期强制宽松模式
   (保底开 + 参与只加分不减分); weightsJson 记录"规则生效日 vs 数据区间", 检测到追溯时预览顶部警示。
3. **09 节口径统一**(见上):我上一版说"投稿汇总25/57存疑"是**我的 bug**——剔 09 后投稿明细求和与汇总 57/57 全对。
   导入对账逻辑要按"汇总 = 明细 − 被剔节"校验, 别把平台汇总误标"存疑"。
4. **权重可调的申诉安全**:仅快照不够(±5pp 就翻转个别学生及格线)。要:权重边界(考勤≥40%、单参与≤30%)+
   **发布即锁定**(改权重生成新版本+审计+显式重发布, 预览先展示"及格翻转"名单)+ 学生可见页展示公式与本人原始值可复算。
5. **文案披露**:「课堂答题按是否作答计参与、不评对错」写进学生/家长可见文案(未批改/瞎选都算已答, 不讲清必被质疑)。

### 落地要点(工程复核):
- **命名**:叫「**课堂表现分** / Classroom performance」——`平时成绩` 已被练一练占用(analytics.dailyScore、
  i18n、成绩册导出列),撞车会造歧义。i18n 键前缀独立(如 `classperf.*`), 三语平价。
- 挂 **CourseOffering**;两表 `ClassPerfImport`(offeringId/schoolId/sessionsJson/weightsJson/fileName…)+
  `ClassPerfStudent`(importId/studentNo/userId/汇总列快照/detailJson 逐节明细)。**detailJson 只存原始信号,
  得分读时由纯函数算**(57×16 极小 ~60KB), **砍掉"重算按钮"**(避免存分漂移)。
- **计次节 = Sheet1 表头标题集(主判定)**, A1 带「（数字）」后缀=重开(次级), 留一法只做诊断;考勤取汇总权威值。
- 题目列:`/^第(\d+)题/` 前缀 + **按列索引迭代**(节内"第1题"会重复出现, 按文本建 map 会丢列);
  "答过" = trim 非空且≠未答题;数字"0"是答了得0分(勿被 falsy 误杀)。
- 重复学号合并=签到 OR、计数 SUM;未匹配学号=预览列出不建号;缺行学生=按花名册补零、按学号匹配(姓名有尾缀脏数据)。
- 独立展示、默认不动现有成绩(`gradebookMode=separate`);老师 insights 全班板 + 学生本人视图(自己+匿名班级对比, minors 隐私)。
- 复审全文见 workflow 结果:`…/subagents/workflows/wf_554681df-91f/journal.jsonl`(3 agent: verify/fairness/impl)。

### 待 clark 拍板
- 是否先建保底/追溯宽松版再上;先 2531320 一个班验证 → 再推其余 7 班;PR 拆 ~6-7 个(schema→解析算分→导入→老师板→学生板→导出集成→配置)。

---

## §4 运维备忘(恢复即用)
- 全走 **GitHub Actions 按钮**(可审计):`admin-call.yml`(端点选单 + JSON payload)、`d1-query.yml`(只读 SELECT)、
  `grading-drain.yml`(input `rounds` + 新增 `kind`)。CRON_SECRET/CF token 在仓库 secrets。
- d1-query 结果打进 Actions 日志;**最小披露**(聚合优先, 非必要不查学生 PII;本档因 clark 要处理坏视频才列了 sub 31723 学生)。
- MCP `actions_list` 返回超 token → 存文件, `python3 json` 提 run id;`get_job_logs` 只能读**已完成**的 job。
- git stop-hook 常误报 b699c08 等为 unverified——那是 clark 的 squash-merge(committer noreply@github.com)、已并入 main,
  **不要 amend/rebase/force-push**。`git log origin/main..HEAD` 为空即无我方待推。
- PR 由 clark 合;合并后分支被自动删 → 新活 `git checkout -B <branch> origin/main` 起、普通 push 新建(force-with-lease 会因 stale 失败, 先 `git remote prune origin`)。
- 本会话新迁移/schema 改动:无(#434 改 wrangler+jobs+drain, #435 改 repo 选择器, 均无迁移)。
