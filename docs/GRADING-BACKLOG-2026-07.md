# 期末考核 AI 评阅落地 · 事故复盘与状态存档（2026-07-07）

> 本文是一次完整会话的存档:从「研究期末考核作业」出发,挖出评阅流水线的系统性瘫痪,
> 修复 ①–⑦ 并清积压。**下次会话从这里恢复上下文**;待办见文末。运维操作一律走
> `OPERATIONS.md` §6(Actions 按钮)。

## 一、作业画像(生产实测,查询通道验证过)

- **期末考核：2025-2026-2**:一个批次(`d6ca0b9e…`,mode=EXAM),**8 个真实班**
  (2531320–2531327,37–58 人/班)+ **1 个「测试班」**(混在正式批次里,考虑摘除)。
- 4 个环节:①题目选择=纯投票(不评分,已统一+归票完成)②提交文本=writing
  ③提交练习视频=speech ④背诵检测=speech+严格防作弊。
- **环节 2/3/4 的 rubric 全空、模型全默认**(Gemini 3.5 Flash 感知 + DeepSeek V4 Pro 评分)。
  正式考试建议老师写评分标准并用评分页「同步到其它班」一次配齐。

## 二、根因链(五层,全部已修)

| # | 根因 | 修复 | PR |
|---|---|---|---|
| 1 | `CRON_SECRET` 从未设置 → 定时排空静默跳过,队列只靠提交后 kick 和开看板自愈 | 已设置(Worker+GitHub 同值) | 运维操作 |
| 2 | drain 端点「先响应、waitUntil 后台跑」→ Workers 响应后 ~30s 掐死后台,批次跑一半死,提交遗留 PROCESSING | 改**同步**执行返回 `{ran}` | #389 |
| 3 | 视频内联阈值 18MB → 内存峰值顶穿 128MB → isolate 被杀 502 | 压到 4MB,大文件走 File API 流式 | #390 |
| 4 | 批内**串行**评 → 一轮墙钟=各份之和,顶穿 curl 超时 | 批内 `Promise.all` 并发 | #391 |
| 5 | GitHub schedule 实际 ~45–70 分钟一班(非 */5) | 工作流可 rounds 连打 + 多泵并行(认领原子,任意并发安全) | #389/#390 |

连带修复:claim 陷阱(卡死 >15min 的 PROCESSING 可被接管,#387)、上传完整性门
(提交时验对象在且非空,`err.uploadIncomplete`,#387)、评前预检(缺失/空文件不烧 AI,#387)。

## 三、数据修复台账

- **407 份文本**(writing 上线前提交、从未入队)→ `backfill-writing-grading` 已 apply;
  顺带清 25 份纯投票幽灵 needsReview(#384)。
- **436 份媒体**(FAILED/卡死/未评)→ 探针(#385)证实 **442/449 对象完好**(404 是暂时性
  取件失败,非数据丢失)→ `requeue-media-grading` 已 apply(#387)。
- **7 份不可救,需人工**:缺失 `8107 / 8111 / 8163`(环节 2 畸形行);空文件(0 字节录像)
  `8350 / 8360 / 9145 / 13343`。重评后落在对应班评分页「评阅失败」,老师给分或让学生重录。
- **连带受害者**:Native English 2000(5/6 月背诵系列)~600 份同样积压 8 天,已随队列
  一并评;**172 份其它标题的死信**待逐标题跑 `requeue-media-grading`(端点按 title 圈定)。

## 四、存档时刻的进行时(2026-07-07 05:40 UTC)

- 排空车队 **18 个泵**(rounds=120,limit=3 并发/轮)在跑/候场;快照 05:36:
  DONE 709 · PENDING 1269 · PROCESSING 37 · FAILED 172(零新增)。吞吐 ~240+/h,
  预计数小时清零。**会话内的自动巡检不跨会话**——下次会话按 §五恢复监控。
- 清零后待出**收官报告**:各环节 aiScored/待批/平均分 + `SUM(costMicroUsd)/1e6` 实际
  花费(费用整数微美元落库,用量页/查询通道均可出)。

## 五、下次会话怎么恢复

1. **看现状**:看板 → 批阅诊断(队列水位 + 按批次的评阅进度);或 Actions →
   `D1 read-only query` 跑 `SELECT status, COUNT(*) FROM GradingJob GROUP BY status`。
2. **队列没清完** → Actions → `grading-queue-drain` → Run workflow(rounds=120),
   多派几个并行;`queue empty` 即毕。
3. **收官四件套**:①收官报告(上面的查询 + 按环节统计);②7 份人工名单交办;
   ③172 死信逐标题 requeue(先 `SELECT a.title, COUNT(*) FROM GradingJob j JOIN
   Submission s ON s.id=j.submissionId JOIN Assignment a ON a.id=s.assignmentId WHERE
   j.status='FAILED' GROUP BY a.title` 拿标题);④建议老师补写环节 rubric、
   考虑把「测试班」摘出正式批次。
4. **老师收尾**:各班评分页复核「待批」(AI 置信度不足的),其余一键采纳 AI 分。

## 六、本次会话的 PR 台账(#383–#392,均已合并)

| PR | 内容 |
|---|---|
| #383 | 生产 D1 只读查询通道(`d1-query.yml`,SELECT-only 守卫) |
| #384 | 写作补评入队端点 + 纯投票幽灵复核清理(修复①) |
| #385 | 媒体探针端点(修复②,定 404 根因) |
| #386 | 维护端点做成 Actions 按钮(`admin-call.yml`) |
| #387 | claim 陷阱修复 + 媒体重评端点 + 上传门 + 评前预检(修复③) |
| #388 | 批阅诊断页(系统配置有无/队列水位/评阅进度,修复④) |
| #389 | 排空同步执行 + 工作流 rounds 连打(修复⑤) |
| #390 | 内联阈值 4MB 流式 + 工作流容错连打(修复⑥) |
| #391 | 排空批内并发(修复⑦) |
| #392 | 诊断页评阅进度按批次分组 |

## 七、后续更新(2026-07-07,会话续跑)

- **评阅队列首轮清零**:PENDING 0 / PROCESSING 0。期末考核实际花费 **≈ $6.90**
  (环节2 $0.64 · 环节3 $3.96 · 环节4 $2.30)。AI 已评:环节2 434/449(均分73)·
  环节3 361/451(均分59)· 环节4 277/410(均分78)。
- **死信复盘(平台级 ~492)**:绝大多数是通用死信 `grading did not complete[/after retries]`
  ——在流水线修好前(#391 并发前、14 泵冲刺 Gemini 限流时段)攒下、attempts 达上限 4 不再
  重试;真·硬错误仅 5 份(Gemini 429×2、413×1、网络×1、writing×2)。媒体探针已证 98% 对象
  完好 → 流水线现全健康,对期末考核**再跑一轮 requeue + 中等强度 drain**(限并发防再撞 429)。
- **CSP enforce 已翻**(见 `CSP-NONCE-OPENNEXT.md`):响应侧 HTMLRewriter 注入 nonce,
  `CSP_ENFORCE="enforce"`,unsafe-inline 从真实页面清除。
- **剩余待办**:①期末考核死信 requeue 后的收官核对(评阅率冲 ~98%);②7 份真不可救
  (缺失 8107/8111/8163、空文件 8350/8360/9145/13343)老师人工;③其它标题(Native English
  2000 shadowing 等)死信按需逐标题 requeue;④环节 2/3/4 建议老师补写 rubric;⑤测试班摘除。

## 八、成本危机应对(2026-07-07,Gemini 账单 $768)

**触发**:Gemini 平台账单 ~$768,远超库内记账(`SUM(costMicroUsd)/1e6` 仅 ~$87)。复盘
出三层问题并逐条处置。

- **账实差因**(为何库比账单少记):`Submission.costMicroUsd` 是**单列**,`applyGradeResult`
  每次评阅覆盖写(重评/重试丢历史);**失败调用完全不记**(catch 里无落库);早期 491 份评阅
  在建列前记为 null;shadow 复用旧句在重试下少计。加之当时默认感知模型是 **3.5 Flash($1.50/1M)**,
  视频评阅按 258 token/帧×1FPS 烧得快。
- **能否拒付**:**不要在 Visa 发起拒付(chargeback)——会触发 Google 封号**。成功的 200
  `generateContent` 是真实产生的用量,按公开单价折算属实(这批是期末考核几千份视频评阅的真账,
  不是幻账)。**失败调用(429/400,处理前被拒)本就不计费**——新账本的失败留痕(ok:false、cost 0)
  正是为印证这一点。若要减免,走 Google Cloud Support 申请 credit(措辞:一次性批处理误配置),
  不走银行拒付。已在控制台设**硬支出上限 $555**。
- **#换模型(见另一 PR)**:默认感知模型 **3.5 Flash → 3 Flash Preview($0.50/1M input)**,
  视频评阅单价降 ~3×。
- **#3 成本记账(真账本)**:新增 append-only 表 **`AiUsageLog`**(每次 AI 调用一行:kind
  perception/judge/writing/shadow、model、真实 token、`costMicroUsd`、`ok`、`createdAt`),
  永不覆盖、失败也留痕。写入在 `lib/repo/ai-usage.ts::logAiCall`(best-effort,绝不抛错到评阅)。
  三条评阅路径(grading/grading-writing/shadow)在落库成功后各记行、失败记 ok:false 行。
- **#4 支出护栏**:`config.gradingDailyCapUsd()`(env `GRADING_DAILY_CAP_USD`,**默认 $50**,
  0=关)。`claimAndRunDue` 最前:当天(UTC 日界)`AiUsageLog` 全平台累计 ≥ 上限时**暂停后台评阅**
  并直接返回(不回收/不夭折,不白烧 attempts);队列原样保留,次日归零或调高上限后自动恢复。
  手动重评(老师触发)不走此路径,随时可评。这是第二道防线,补在 Gemini 控制台硬上限之后。
- **可见性**:批阅诊断页(`/dashboard/diagnostics`)新增「AI 评阅花费」卡——今日/本月(按校)+
  今日调用数/失败数 + 单日护栏值 + 已暂停提示。旧「用量/费用」页仍读被覆盖的单列,新账本是真账口径。
- **仍存局限**(可接受,均属边角少记而非旧账的系统性漏记):已计费但解析失败的 200(gemini 抛错前
  拿不到 usage)成本记 0;shadow 重试复用旧句不重记;账本失败留痕不计入护栏累加(失败本不计费)。
