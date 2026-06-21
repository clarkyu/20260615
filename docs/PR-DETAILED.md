# 全部 PR 逐个详评（#1 – #212）

> 从 PR #1 到最新,逐个 PR 的详细内容。每条:**#号 · 标题 [合并时间]**,随后是该 PR 的真实改动(取自 PR 描述,经复核归纳)、涉及的数据迁移/关键文件、以及要点/隐患。按演进阶段分节。
> 生成于 2026-06-19。验证口径:几乎每个 PR 都标了 tsc/lint/test/build 全绿(下文不再逐条重复"全绿",仅在有特别处标注)。

---

## 阶段 0 · MVP 与快速成形（#1–#22，06-15）

**#1 · 英语背诵作业 App（手机端录制提交 + AI 评阅 + 按班级导出）** `[06-15 08:26]`
整个应用的初始提交。建在 ScoreProphet 自托管栈(Next.js 15 + Prisma/SQLite + iron-session)之上。**数据模型(init 迁移)**:School/ClassGroup、带角色 User(SUPER_ADMIN/SCHOOL_ADMIN/TEACHER/STUDENT)+ 学生资料、Assignment/Sentence/AssignmentClass、Submission(含 AI 结果 + 防作弊字段)。**认证**:老师邮箱注册+邮件验证(ADMIN_EMAIL 首注册为超管)、学生「学校代码+学号」登录(初始密码=学号、首登强制改密)、`requireRole`/`requireStaff` 守卫。**老师端**:建校、Excel 名单导入(ExcelJS,按学号 upsert、按班级列自动建班)、发布作业、阅卷看板(模型预设/高级 + 填评分标准 + AI 评阅 + 人工改分 + 看视频)、按班导出。**学生端**:前置摄像头录制(MediaRecorder)+ 全屏 + 切屏违规记录 + 预签名直传 R2。**AI**:模型注册表(7 家)+ 两段式编排(感知→评分)+ **占位适配器**(流程跑通,接 key 即替换)。19/19 测试。决策:数据库 SQLite、防作弊 PWA 检测+标记。

**#2 · 授课支持一次选多个班级** `[06-15 10:44]` 新建授课时班级单选→多选勾选框,按「课程+班级+学期」`createMany` 批量建;校验归属本校、跳过已存在;单班直达详情、多班回列表。编辑授课仍单班。

**#3 · 各页面加班级/学期/状态筛选器** `[06-15 11:48]` 授课列表(班级+学期下拉,仅一个时自动隐藏)、班级多选(>6 出搜索框、勾选镜像到隐藏 input 不丢失)、学生名单(班级搜索)、阅卷页(状态+姓名/学号筛选)。新增 `filter.*` i18n。

**#4 · 作业可一次发布给多个班级** `[06-15 11:58]` 新建作业列出同课同学期你教的其他班作为发布目标(当前班默认勾选),一次批量为每个授课各生成一条作业(句子相同)。新增 `asg.publishTo` 等键。

**#5 · 班级筛选支持系部/专业/年级** `[06-15 12:34]` `ClassGroup` 加 `grade`(迁移 0004);名单解析从班名提取 4 位年份(「专科2025…」→2025)、`23级`→2023;导入自动补全缺失系部/专业/年级(只填空不覆盖);学生名单页三下拉筛选;加年级提取单测。

**#6 · 登录加学校下拉 + 老师工号登录 + 自助设工号/改校名** `[06-15 12:52]` 学校改下拉(代码仍保留可切换);老师「学校+工号+密码」登录(保留邮箱兜底);`User` 加 `staffNo`(按校唯一,迁移 0005);个人资料可设工号、改校名;登录页 `force-dynamic`(请求时读学校,避免构建期访问 DB)。

**#7 · 密码框加显示/隐藏开关** `[06-15 13:00]` 新增可复用 `PasswordInput`(眼睛切换明/密文),覆盖所有密码框。

**#8 · 规范化院系/专业，加手机号与教师部门** `[06-15 13:28]` 把院系/专业从班级上的字符串规范化为正式实体:新增 `Department`/`Major`,`ClassGroup→majorId`,`User` 加 `phone`/`departmentId`;**迁移 0006 自动回填**(现有班级文字→生成实体并关联);导入按「院系→专业→班级」建层级。院系=教师部门同一套。

**#9 · 修复老师发布作业失败（D1 事务）** `[06-15 13:35]` **关键 bug 修复**:#2 多班发布把 `assignment.create({sentences:{create}})` 包进 `$transaction([...])`,但 **D1 没有交互式事务**、批量里拿不到新作业自增 id 去插句子→发布失败。改回每个授课单独 `await create`。这是 D1 限制的第一次踩坑。

**#10 · 发作业改为「先写作业，再勾选授课班级」** `[06-15 14:39]` 新增顶层 `/dashboard/teaching/new-assignment`:先写作业→勾选授课班级→一次发布;授课页加「新建作业」按钮;`AssignmentForm` 改为通用带标签目标。

**#11 · 重设计 P1：学生录制提交流（倒计时+引导）** `[06-15 14:50]` 降低录像焦虑:**3-2-1 倒计时**(先亮预览再倒数才真录)、镜像竖屏取景、常驻「请闭眼背诵」、计时+违规胶囊、提交入场动画、编号圆点进度。录制/上传/防作弊逻辑不变。

**#12 · 重设计 P2：老师逐个批改流** `[06-15 14:55]` 作业页新增全屏「逐个批改」:一次一个学生、大视频内嵌、AI 建议分(一键运行/采纳)、快速打分+评语、保存·下一个、N/总数进度;从首个待评阅自动开始。

**#13 · 重设计 P3：老师首页行动台 + 待批改看板** `[06-15 15:00]` 首页围绕日常任务重排:待办横幅「N 待评阅·M 今天截止」、大号「发作业」主行动卡、待批改看板(每作业课程·班级+待批数、点进批改页)、底部统计。至此学生提交流/老师批改流/老师首页三阶段完成。

**#14 · 统一简化登录页** `[06-15 15:13]` 老师/学生**统一登录**(学校下拉+学号/工号+密码,一个按钮、无角色切换);**取消公开注册**(/register、/student-login 重定向 /login);保留邮箱兜底;去掉学校代码。后端按学号/工号在所选学校匹配并按角色跳转;删除冗余登录表单。

**#15 · 登录默认学校/去邮箱登录 · 班级名精简 · 全员邮箱手机** `[06-15 15:22]` 学校下拉默认「武汉警官职业学院」;去掉邮箱登录入口(后端保留兜底);发布作业班级名只显示班号(重复才补课程名);个人资料/学生表单/名单导入加邮箱(全局唯一,冲突不中断导入)+手机。

**#16 · 应用改名：你好！作业 / Hi, Homework** `[06-15 15:33]` 改名(i18n/APP_NAME/标题/manifest);`APP_URL` 暂留旧域名,等 hihomework.com 生效再切,避免邮件链接失效。

**#17 · Worker 改名 hihomework，APP_URL 切 www.hihomework.com** `[06-15 15:50]` `wrangler.jsonc` Worker 名同步为 hihomework(否则自动部署跑去错 Worker);APP_URL 切到已确认可用的 www.hihomework.com。D1/R2 资源名不受影响。

**#18 · 强制跳转到 www.hihomework.com** `[06-15 15:56]` 新增中间件:所有非规范域名(workers.dev/根域/旧域/http)**308 跳转**到规范域;规范域不跳(避免循环);静态资源排除。

**#19 · 发布作业：班级全选 · 月份下拉 · 句子可选** `[06-15 16:06]` 班级勾选加全选/取消全选(受控);月份改下拉(上月→未来 11 月);背诵句子改为可选(留空则学生默写一步自填,录制页无句子时不显示复习列表)。

**#20 · 作业提交类型(文本/音频/视频)+ 说明 + 题目改名** `[06-15 16:38]` 老师勾选提交内容(默写/录音/录像,至少一项,新增 `requireText/Audio/Video`,迁移 0007);加「说明」;「背诵句子」→「作业题目」;学生提交流改动态步骤+音频模式;阅卷可听录音。

**#21 · 作业分类 + 手写文本提交** `[06-15 16:49]` `Assignment.category`(datalist 预设可自由输入);手写文本开关 `requireHandwriting`;学生端 `PhotoStep` 拍照/选图上传,`Submission.imageKey`,批改页可看图(迁移 0008)。

**#22 · 作业列表/卡片显示分类标签** `[06-15 17:00]` 在学生作业列表/详情、教师授课作业列表/看板/批改页头显示分类徽章(复用 `Badge`),纯展示无迁移。

---

## 阶段 1 · 五段式重构（#23–#27，06-15~16）★产品骨架

**#23 · 重构 Phase 1：评分领域层 + AI 置信度分流地基** `[06-15 17:27]` 「世界顶级 AI 教育产品」重构路线第一阶段(纯地基、不改行为)。新增 `domain/grading.ts`,把「评分一份提交」的端到端编排(取媒体→感知→评分→落库)从 action 抽到领域层(不依赖 auth/i18n,可单测、将来可被队列复用);`runGrading` 瘦身为薄 action。`JudgeResult` 加 `confidence`(0..1);**`decideReview` 纯策略**(高置信+无作弊→免复核;未知→默认复核 fail-safe);`Submission` 加 `confidence`/`needsReview`(迁移 0009)。策略单测 6 例。

**#24 · 重构 Phase 2：学生即时学练闭环** `[06-15 17:42]` 「学习发生在练习里」:学生正式交前可「练一练」(朗读→AI 即时点评→反复练)。**练习无限次、不计正式次数**;新增 `PracticeAttempt` 表(迁移 0010,为 Phase 4 积累数据);`domain/practice.gradePractice` 复用 AI 管线、未配 key 优雅降级;`actions/practice`;学生端 `PracticePanel`(录音→评分→结构化反馈卡)。

**#25 · 重构 Phase 3：老师 AI 先批改 · 只看例外** `[06-15 23:25]` 把老师从「逐个批 60 份」解放成「只看 AI 拿不准的」。**提交即自动评分**(`runAfterResponse` 用 Worker `waitUntil` 响应后跑,学生不等);高置信自动通过、低置信进「待复核」;未配 key 优雅退回全人工、不阻塞学生;批改页加待复核看板+「只看待复核」筛选;`acceptAiForAssignment` 一键全部按 AI 分通过(scoped raw UPDATE)。无迁移。

**#26 · 重构 Phase 4：学情分析** `[06-15 23:39]` **零新表零迁移**,直接从 Submission 实时聚合。`domain/analytics.ts`(纯函数,单测 7 例):`assignmentStats`(提交人数/均分/待复核)、`studentProfiles`(提交率+均分+**风险识别**:提交率<50% 或均分<60,风险置顶)、`weakSentences`(跨学生逐句准确度找最难句)、`offeringSummary`/`parsePerSentence`。新增授课学情页(四宫格+需关注学生+最薄弱句热力条+逐次作业)。

**#27 · 重构 Phase 5：AI 备课出题** `[06-16 00:10]` 消灭空白页:老师给主题/课文或**拍课本照片**,AI 起草整份作业(标题/分类/说明/逐句题目)回填表单。`gemini.geminiAuthor`(多模态,图片 inline base64≤6MB 不经 R2)、`domain/authoring.draftAssignment`、发布表单加「AI 帮我出题」面板。配 GEMINI_API_KEY 即真实可用。无迁移。

---

## 阶段 2 · 质量审查 + 上手 + 默认值（#28–#32，06-16）

**#28 · 代码质量审查修复（媒体管线 / IDOR / 置信度 / 健壮性）** `[06-16 00:26]` 源自四维度审查,按严重度修。**🔴 CRITICAL**:① `next.config` 的 `Permissions-Policy: camera=()` + CSP 把录制/上传整条链路掐死 → 放开到 self + 放行 `*.r2.cloudflarestorage.com`(修复录制→上传→评分→回看);② **练习接口 IDOR** — `gradePracticeAttempt` 之前对任意 `mediaKey` 签名,改为校验必须是 `practice/{assignmentId}/{本人id}/` 前缀(杜绝越权读他人录音);③ **confidence 从未接到真实模型** — Gemini 的 schema/prompt/normalize 接入并 clamp,此前真实 Gemini 永不返回置信度→「高置信自动通过」生产从未触发;④ 裸 `JSON.parse(violations)` 致整页 500 → 带守卫的 `countViolations`。**🟠 HIGH**:`isUnavailable` 收紧只匹配自有 sentinel(不再把真 401 误判为未配置)、`acceptAiForAssignment` 用 COALESCE 不覆盖老师分+排除 FLAGGED、`finishSubmission` 幂等翻转(并发不重复评分)、逐个复核快照工作列表(修索引漂移)。

**#29 · 老师上手：添加老师 / 手动建班级 / 三步引导** `[06-16 00:46]` 补「老师视角 #1 硬伤」:此前无法给同事开账号、班级只能靠导入产生。`staff.addTeacher`(同校老师加同事,初始密码=工号强制改密)+ `/dashboard/teachers`;`addClassGroup`(仅填班号建空班);首页「三步上手」清单(建班→建授课→发作业按完成态勾选)。无迁移。

**#30 · 教学默认值：音频背诵 / 多次提交 / 逐句反馈给学生** `[06-16 00:54]` 把作业默认从「闭眼录像监考基调」改为「学习基调」:默认音频朗读、可交 3 次(取最近)、学生看逐句反馈(用 AI 逐句 accuracy/completeness 标弱句)。仅影响新建、无迁移。

**#31 · 默认提交方式改回闭眼录像背诵** `[06-16 01:00]` 按要求把默认背诵形式从音频改回闭眼录像,保留 #30 的多次提交+逐句反馈。仅调发布表单默认勾选。

**#32 · 平时成绩(练一练) 与 测试成绩(提交) 分开呈现** `[06-16 01:12]` 同一作业两轨并行各自出分:练习→平时成绩、正式提交→测试成绩。`analytics.studentProfiles` 加 `dailyScore`(每作业最佳练习分跨作业平均);学情页四宫格改「学生/平时/测试/风险」;领域单测 +2。无迁移。

---

## 阶段 3 · 题库系统（#33–#41，06-16）★内容资产

**#33 · 题库基础 + 跟读句集管理（PR A）** `[06-16 01:36]` 题库第一步。**迁移 0011**:`ChunkSet`(句集名+整套跟读视频 key)、`Chunk`(双语句子)、`Sentence` 加 translation、`Assignment` 加 shadowVideoKey。`bank.parseBilingual`(解析「英文|中文」粘贴,纯函数单测 3 例);`actions/bank`(建/删句集、传整套视频);`/dashboard/bank` 列表 + 详情页(句子列表+传视频)。

**#34 · 题库句子三段式（中心句/解释句/情境例句）** `[06-16 01:48]` 按材料更正:每句 3 部分(中心句+解释句+情境例句)各中英对照,跟读视频按三部分录。**迁移 0012**:`Chunk` 加 meaningEn/Zh、exampleEn/Zh;`bank.parseChunks` 解析空行分隔的三段式块(容缺译文/段、去行号与 Means:/Example: 前缀);详情页分三段展示。

**#35 · 从题库发布 + 学生竖屏跟读（PR B）** `[06-16 01:58]` 打通题库到课堂。**迁移 0013**:`Assignment.chunkSetId`;`createAssignment` 支持从句集取整套视频+句子、默认音频;`AssignmentForm` 题库模式;`/dashboard/bank/[id]/publish`;学生端 `ShadowingReference`(竖屏视频+三段式双语+中文开关)。闭环打通:建句集→录三段式→传视频→发布→学生竖屏跟读→录音提交→评分。

**#36 · 题库可编辑（改名 + 重排句子）** `[06-16 02:05]` 句集从「删了重建」改为可编辑:`bank.serializeChunks`(parseChunks 逆操作,round-trip 单测)、`updateChunkSet`(改名+事务内 deleteMany→createMany 覆盖)、详情页加编辑表单。无迁移。

**#37 · 跟读作业逐句录音逐句提交（#2 B）** `[06-16 02:28]` 按选择 B:整套发布、学生逐句过(每句单独录一条)。**迁移 0014**:`ShadowTake`(每句一条录音);`getShadowTakeUploadUrl`(逐句直传、刷新续录)、`finishShadowing`(全部录齐才能交、幂等);学生端 `ShadowSubmit`(逐句卡片+录音/重录+进度条);老师 grade-focus 可逐句回听。

**#38 · 学情→一键复习薄弱句（#3）** `[06-16 02:35]` 学情看完有下一步:`createReviewAssignment` 重算 weakSentences、取最弱 12 句真实文本去重、新建复习作业并跳编辑页设截止;学情页「最薄弱句」显示真实文本+「一键复习」按钮。按班整体复习。无迁移。

**#39 · 学生体验：我的成长 + 反馈细节 + 练习引导/跟读连录** `[06-16 02:45]` ①首页「我的成长」卡(平时/测试/完成度+进步鼓励);②评阅展示识别文本 transcript + 弱句下「你读成:…」(spokenText);③练习卡引导文案 +跟读录完自动滚下一句。无迁移。

**#40 · 逐句 AI 评分（接 #2 B）** `[06-16 02:52]` 每条 take 自动按其句评分并汇总。**迁移 0015**:`ShadowTake` 加 aiScore/spokenText;`domain/shadow.gradeShadowTake`(准确度 0.7+完整度 0.3,0~100)、`gradeShadowSubmission`(分批并发 4、allSettled 容错、未配 key 退人工、高分≥85 且最弱≥60 自动通过、生成中文评语);提交后 `runAfterResponse` 后台触发。
**#41 · 全班成绩单 + 导出（#4）** `[06-16 02:58]` 学情页加「全班成绩单」表(按学号列出每生 平时/测试/完成度)+「导出成绩单」路由 `/gradebook`(`roster.buildGradebookWorkbook` 生成 xlsx)。老师看全班、学生看自己,一体两面。无迁移。

---

## 阶段 4 · UI 精致度（#42–#43，06-16）

**#42 · 暗色模式 + 恢复缩放 + 中文字体（UI #1）** `[06-16 03:08]` `.dark` token 早齐,这次接上:无闪烁初始化脚本(首帧前按 cookie/系统偏好加 `.dark`)、头部 `ThemeToggle`、themeColor 双值;**恢复双指缩放**(移除 maximumScale,WCAG 1.4.4);中文 fallback 到 PingFang/雅黑/思源系统字体(零下载)、`:lang(zh)` 加大行高字距。纯前端。

**#43 · 骨架屏 + 进步高光 + 品牌/a11y/题库入口（UI #2+#3）** `[06-16 03:15]` `.skeleton` 微光占位 + `Skeleton` 组件(替媒体加载灰框);`.animate-pop` 庆祝动效(reduced-motion 自动关);提交对勾/「比上次进步」用 pop 高光;品牌字形 背→你;a11y(底部导航 aria-current、开关 aria-pressed);**题库进老师底部导航**(5 tab)。

---

## 阶段 5 · 架构加固（校验边界 + 异步批改 + 分层重构）（#44–#61，06-16）★可维护性核心

**#44 · zod 校验边界基座 + 名册/内容 actions（#二-1）** `[06-16 03:27]` 在 action 边界引入单一可信校验层。`lib/validate.parseForm(schema, formData)` + 构造器(reqText/optText/checkbox/idList/reqId/intField),校验消息即 i18n key,首错返回(单测 4 例);依赖 zod v4。转换名册/内容类 7 个 action。行为不变、只收敛输入。

**#45 · 作业与批改 actions 接入 zod（#二-2）** `[06-16 03:32]` 作业发布/编辑(title/分类/月份/说明/五开关/maxAttempts)+ 批改(runGrading/overrideScore 含分数范围/acceptAi)全走 parseForm。

**#46 · 账号/学校 actions 接入 zod（#二-3 收尾）** `[06-16 03:37]` 改资料/邮箱手机/建校改名走 zod;`optId` 新增。**关键判断**:`login` 刻意保留既有校验(每条未命中路径调 `fakeVerifyPassword` 做**时序安全**,改 zod 早退会泄露时序);register/reset/verify/changePassword 同理不强行 zod 化。至此 zod 覆盖全部租户数据写入面。

**#47 · 批改异步工作流：持久任务 + 有界重试 + 自愈（#三）** `[06-16 03:50]` 把提交后自动批改从「尽力而为(waitUntil 跑一次丢了就丢)」升级为持久+有界重试+自愈。**`GradingJob` 表(迁移 0016)**:submissionId 唯一,状态机 PENDING→PROCESSING→DONE/FAILED + attempts/nextAttemptAt/lastError。`domain/jobs.ts`:`enqueueGrading`(幂等)、`claimAndRunDue`(先回收>5min 卡死的 PROCESSING,再用乐观锁 `updateMany(status=PENDING)→PROCESSING` 认领,绕开 D1 无事务、两 isolate 不重跑)、指数退避(1/2/4 分)、超 MAX_ATTEMPTS=4 进死信、`drainGradingJobs` 吞错;教师面板加载顺带自愈重扫。死信不丢工作(仍在人工队列)。

**#48 · 分层重构 #一-1：仓储层 + 薄 action 基座** `[06-16 04:23]` 「彻底分层重构」第一刀。确立三层:薄 action(鉴权→校验→委派→重验/跳转,不碰 prisma)、领域服务、仓储(**多租户作用域集中到一处**)。`action-context`(staffContext/staffSchoolContext 统一前置三连);`repo/{classes,courses,offerings,bank,users,schools}`(`schoolId ?? -1` 哨兵从散落收到每个聚合一处——越权拦截只此一份、可审计);收口授课/题库/教师/学校 CRUD。页面只读暂留直连。行为不变(where 逐一镜像)。

**#49 · 分层重构 #一-2：作业与批改垂直收口** `[06-16 04:30]` 最复杂热路径。`repo/assignments`(经 offering.schoolId 作用域、按句集发布、整批换句、复习作业、deleteForSchool 返 offeringId)、`repo/submissions`(findForStaff、acceptAiForAssignment 保留 COALESCE 原始 UPDATE)、薄化 actions/{assignments,grading}。

**#50 · 分层重构 #一-3：学生提交与练习 + 上下文统一** `[06-16 04:37]` 学生侧。`staff-action.ts → action-context.ts`(加 studentContext);`domain/submit.ts`(resolveAttempt 班级/窗口/次数闸门、missingRequiredPart 逐字保留);`repo/submissions`(学生只碰自己行)、`repo/practice`;批改调度收进 `scheduleGrading`。

**#51 · 分层重构 #一-4：学生名册垂直收口（最大一支）** `[06-16 04:43]` `students.ts`(314 行最大 action)落三层。`domain/roster.importRoster`(上百行批量导入整体提到领域层——内聚数据编排单元,有意整体保留直连 prisma、逐字搬移);`repo/classes`(含 deleteWithStudents)、`repo/users`(学生 CRUD)、`repo/majors`。batch roster 是少数「领域直连 prisma」的合理例外(已注明)。

**#52 · 分层重构 #一-5：配置集中化 + 启动自检 + 分层文档（#一 收尾）** `[06-16 04:50]` `lib/config.ts`(env 唯一来源:类型化 getter + 能力开关 storageConfigured/emailConfigured/aiConfigured + `configReport()` 脱敏快照 + `validateConfigOnce()` 启动自检,**只报名+有无、绝不打印值**);收口散落 process.env(storage/session/app-url/email/gemini);root layout 调 validateConfigOnce(缺变量首请求即日志可见);config.test.ts(7 例,含「报告不含密钥值」);`docs/ARCHITECTURE.md`。**auth 登录刻意未薄化**(恒定时间假校验防时序侧信道)。

**#53 · 归档系统架构方案为 Skill** `[06-16 04:54]` 把分层约定固化为 `.claude/skills/system-architecture/SKILL.md`(分层速查、决策树、可照抄范式、D1 约束、两处有意边界、安全不变量)。与 ARCHITECTURE.md 互为可执行/参考版。纯文档。

**#54 · 分层强约束：禁止 action 直接碰 prisma + 补 zod** `[06-16 05:05]` 把分层从约定升级为 **lint 硬约束**:`.eslintrc` 对 `src/actions/**` 禁 import `@/lib/db`/`@prisma/client`、禁 `prisma.x`/`cx.prisma.x` 查询(AST selector),auth.ts 按设计豁免;`jobs.scheduleGrading` 把 getDb/runAfterResponse 从 action 收进领域层使规则全量生效;updateClass/updateStudent 补 zod。实测规则有牙(负向测试)。

**#55–#60 · 页面只读查询收进仓储（阶段 1–5b）** `[06-16 05:10~06:06]` 把页面(Server Component)散落的 ~97 处 prisma 查询**逐步**收进 `lib/repo`,分 6 个 PR:① 题库 3 页(#55)、② 授课 6 页(#56)、③ 名册/教师/资料 4 页(#57)、④ 作业/批改/导出 3 页(#58)、⑤a 仪表盘/学情/成绩册 3 页(新增 `repo/dashboard` 读模型,#59)、⑤b 学生端+登录 3 页(#60 收官)。**22 个页面/路由全部收口,`grep prisma. src/app` → 0 处**。每阶段 where/select/include/orderBy 逐一镜像、行为不变。仓储复用逐渐显现。至此你定的三项后续(页面收仓储/zod/lint 强约束)全部完成。

**#61 · auth：把资料更新两个 action 的数据访问收进仓储** `[06-16 06:20]` 「小而稳」:只收 auth.ts 里**纯资料 CRUD**(updateStaffProfile/updateContact),安全敏感部分(login 恒定时间、token 单次轮换 $transaction、register/changePassword)一律不动、保留 lint 豁免。

---

## 阶段 6 · 安全修复 + 代码评审 ①–⑧（#62–#72，06-16）★安全/正确性

**#62 · #1 限流改 D1 共享存储（修真实安全缺口）** `[06-16 06:34]` 限流原本是 **per-isolate 内存计数**,Workers 多 isolate → 有效上限=设定值×isolate 数,暴力破解防护基本被绕开。**`RateLimit` 表(迁移 0017)** + `checkRateLimitD1`(一条原子 `INSERT…ON CONFLICT DO UPDATE…RETURNING` 搞定窗口计数,跨 isolate 共享、无需事务,2% 概率清过期行);无 D1(本地/测试)回退内存版。限额数值不变,只是现在真全局生效。

**#63 · #2 学生转班后会话自愈** `[06-16 06:37]` 老师转班后学生 session 里还是旧 classId,提交闸门按 classId 校验→把学生挡在新班作业外。`studentContext` 取一次 DB classId,不一致就更新 session(一次主键查询、cookie 只在真换班那次重写)。

**#64 · #3 删除表单防双击** `[06-16 06:41]` `SubmitButton`(useFormStatus,pending 时自动禁用),套到 4 个删除表单(删作业/句集/班级/授课),防破坏性删除发两次。

**#65 · 代码评审 ①：后端正确性** `[06-16 07:03]` `ACTIVE_STATUSES` 补 **FAILED**(批改失败已耗一次 attempt,原不计数→学生白得一次);`listForOfferingLatestFirst` **和** `listForAssignmentStudents` 加 `status:{not:DRAFT}`(新一轮草稿盖住上轮已评分→成绩册/导出漏分);roster `createMany` 失败回退逐行(撞唯一键不再整份不导入);jobs stale-reclaim 5→15 分(慢但活着的大跟读批改不被误回收)。

**#66 · 代码评审 ②：录像/上传组件生命周期** `[06-16 07:08]` recorder:arm 前 cleanupStream(重录不叠流)、卸载后停摄像头/麦克风(红灯灭、防泄漏)、object URL revoke(低内存手机内存泄漏)、cleanup 统一 exitFullscreen;photo-step/shadow-submit 同类清理;submission-flow 步骤索引夹紧(修纯文本+已交文本越界渲染录像分支)。

**#67 · 代码评审 ③：配置 + i18n 一致性** `[06-16 07:14]` 修 config 与 layout **两套默认应用名**(统一走 config.appName);新增 config.adminEmail;roster 表头错误/students 裸英文 → i18n key;去重 DEFAULT_RUBRIC。

**#68 · 代码评审 ④：批改状态机走仓储** `[06-16 07:19]` grading.ts/shadow.ts 原绕过仓储直写 prisma(与 SKILL 不符)。`repo/submissions` 新增命名状态转移(markProcessing/markFailed/revertToQueue/applyGradeResult/applyShadowResult/setShadowTakeScore);domain 改调仓储;SKILL 明确 domain→prisma 例外仅 roster + jobs。

**#69 · 代码评审 ⑤：限流防御纵深 + FK 漂移说明** `[06-16 07:23]` 限流 D1 失败拆两段(无绑定静默退内存、真故障 console.error 再退,原先一个 catch 把限流悄悄降到≈关掉);客户端 IP 优先 `CF-Connecting-IP`(不可伪造);**FK 漂移**:ClassGroup.majorId/User.departmentId 用 ADD COLUMN 加、SQLite 无真 FK、onDelete SetNull 失效,但应用内无删除院系/专业入口→悬挂引用不可达,重建中心表高风险低收益→不做,文档记为已知限制(即后来的 Parked B4)。

**#70 · 代码评审 ⑥：清理（死键/冗余仓储/a11y）** `[06-16 07:28]` 删 27 个无引用 i18n 死键(54 行,grep 确认零引用,tlogin. 因 2 处在用而保留);删过取 passwordHash 的 listClassStudents、导出改轻量 listClassRoster;a11y(拖拽区 div→button、练习/AI 卡补 role=button+tabIndex+onKeyDown)。

**#71 · 代码评审 ⑦：补测 submit + shadow** `[06-16 07:32]` shadow 抽出纯函数 `summarizeShadow`(阈值可单测);submit.test(missingRequiredPart + resolveAttempt 9 例)、shadow.test(5 例)。100 通过(+14)。

**#72 · 代码评审 ⑧：补测 offerings + roster（收尾）** `[06-16 07:36]` offerings.test(8 例)、roster.test(5 例,含 createMany 撞库回退逐行、丢冲突邮箱保留学生——评审标的最高风险未测文件)。113 通过(+13)。A–E(后端/一致性/安全/schema/清理+测试)全部完成。

---

## 阶段 7 · 时区/上传/R2/AI 模型/BYOK（#73–#85，06-16）

**#73 · 修复：作业开放/截止时间时区错误 + 错误边界** `[06-16 07:58]` **根因**:datetime-local 是本地墙钟(老师选 09:00),UTC 服务器当 09:00 UTC=17:00 中国→学生上午看「未开放」8 小时。修复:开放/截止在客户端做时区转换(显示 UTC→本地、提交本地→UTC ISO 带 Z);加 `app/error.tsx` 错误边界(白屏换可截图的真实报错+digest)。

**#74 · 加固：作业表单日期值改为水合后计算（修月底崩溃）** `[06-16 08:23]` 月份下拉在渲染期用 `new Date()`,SSR(UTC)与水合(本地)在月份边界得不同窗口→default 不在 option 集合→React 19 升级成 client-side exception(白屏)。改 useState+useEffect 客户端算。诚实说明:月底必现、但当天月中不触发,多半不是当前崩溃根因。

**#75 · 数据校正：历史作业时间回拨 8 小时（migration 0018）** `[06-16 08:35]` 一次性迁移把 #73 修复前的行回拨 8h。安全:用 `strftime(…datetime(x,'-8 hours'))||'+00:00'` 精确复刻 Prisma 的 TEXT 格式(裸 datetime 会丢 +00:00);守卫 `updatedAt < 修复上线时刻`(新数据不动);用 better-sqlite3 + 真实表结构副本实测往返一致。

**#76 · 诊断：上传失败显示具体原因** `[06-16 10:27]` 上传失败从笼统提示改为自描述:PUT 被拒附状态码(403→R2 权限)、fetch 抛错附错误名(TypeError→CORS/网络),覆盖录像/拍照/逐句三路径。

**#77 · wrangler：R2 桶绑定改为 hihomework** `[06-16 10:34]` 旧桶 recitations 已删,binding 仍指向它→下次部署失败,改为 hihomework。(实际上传去哪个桶由 `R2_BUCKET` secret 决定。)

**#78 · AI 模型：登记 Gemini 3.5 Flash + 3.1 Pro** `[06-16 11:22]` registry 写死的模型清单补登 gemini-3.5-flash(稳定、跑量)、gemini-3.1-pro-preview(难例复核)+「Gemini 3.5 一把梭」预设。适配器 model-agnostic(拼模型名不特判);默认仍 2.5-flash 不变。

**#79 · AI 模型：登记 Gemini 3 Flash 预览** `[06-16 11:31]` gemini-3-flash-preview(比 3.5 便宜的折中档),默认不变。

**#80 · AI 模型目录（用户中心·BYOK 第1段）** `[06-16 12:15]` `/profile/ai` 模型目录:按各家分组,每模型标使用范围(感知/评分)+模态+价格+ID;registry 加 PROVIDER_LABELS/PROVIDER_KEY_ENV/MODEL_PRICING(为 BYOK 铺底)。纯展示不碰密钥。
**#81 · BYOK 密钥（用户中心·第2段）** `[06-16 12:24]` 老师在 `/profile/ai` 填自己各家 API key 加密存库。`lib/crypto.ts` **AES-256-GCM**(密钥派生自 SESSION_SECRET、无需新密钥、Web Crypto);只存密文+iv+末 4 位(`AiKey` 表 迁移 0019,按 (userId,provider) 唯一);页面只显「已配置 ••••XXXX」、**明文永不回传**;6 把凭据槽。`repo/ai-keys`(D1-safe upsert)。

**#82 · BYOK 批改用老师本人 key（第3段·收官）** `[06-16 12:36]` 批改时用「作业所属老师」自己的 key,**没配/解密失败/表不存在任一情况都回退平台 key**(对现有批改零回归)。`key-context.ts`(AsyncLocalStorage 按 provider 注入,apiKey 先读 override 再回退 env)、`teacher-keys.ts`(解密成 provider→key,best-effort);grading/shadow 按 assignment→offering→teacher 解析、`withAiKeys` 包裹。BYOK 三段齐活。

**#83 · 默认批改模型改为 Gemini 3.5 Flash** `[06-16 16:46]` `DEFAULT_PERCEPTION/JUDGE_MODEL`→gemini-3.5-flash;批改默认预设排到「3.5 一把梭」;备课保持 2.5。成本约 2.5 的 5 倍(400 人一轮 ¥105 vs ¥23,已确认)。

**#84 · BYOK 接入备课/练习** `[06-16 16:55]` 备课出题用当前老师 key、练习反馈用作业所属老师 key,都 fallback-safe。至此批改/备课/练习三类用途全走 BYOK。

**#85 · 每位老师自己的默认批改模型** `[06-16 17:07]` `User` 加 defaultPerceptionModel/defaultJudgeModel(迁移 0020);`/profile/ai` 加「我的默认批改模型」两下拉;模型解析统一为**作业指定→老师默认→平台默认**,覆盖自动批改/逐句/练习三路径;`offeringTeacher` 一次查询返回 teacherId+默认模型(省一次查询)。AI 自配完全体。

---

## 阶段 8 · 题库分级 + 全球化 + 2000 句中文回填（#86–#123，06-16~17）

**#86 · 题库 Phase 0：课程骨架 + 首批样题（增量①）** `[06-16 17:51]` 把题库的单一真值(课程脊柱)落进代码,纯新增不碰 app。`taxonomy.ts`(学科无关脊柱:Subject→Strand 技能树、CEFR 主标+CSE/ACTFL 对照、领域、L1 叠加、语音特征标签、统一 ItemMeta);`seed.ts`(首批 8 条发音+跟读样题,载荷按题型多态、带中/西 L1);`taxonomy.test.ts`(conformance:样题必须引用合法 strand/级别/领域、id 唯一、内容非空)。120 通过(+7)。

**#87 · 题库分级：句集加 CEFR/技能/领域/标签/来源（增量②）** `[06-16 18:09]` 句集挂到课程体系:`ChunkSet` 加 cefr/strand/domain/tags/source 五可空列(迁移 0021,老句集无需回填);`bank-meta-fields.tsx` 建/改表单共用分级字段(数据源自 taxonomy);详情页徽章。

**#88 · 题库：一键导入官方样题包（增量③）** `[06-16 18:19]` 让题库从空到有。**生产安全取舍**:真正「全局共享」需整表重建,考试期生产库风险太高→本期用**纯 INSERT 幂等的「导入到本校」**(不改表、零风险),全局留到非考试窗口。`starter-bank.ts`(SEED_ITEMS 投影成句集);`importStarterBank`(按 source 跳过已存在、可重复点)。首批 7 套(Pre-A1→A2)。

**#89 · 题库：按级别/技能/领域筛选（增量④）** `[06-16 18:31]` 题库列表加 CEFR/技能/领域筛选;`bank-filters.tsx`(URL 驱动、可分享/后退/刷新保留);空结果区分「还没有」与「无匹配」。125 通过。

**#90 · 题库：真·全局共享题库（增量⑤）** `[06-16 18:54]` 趁内容基本为空、无生产风险时做整表重建。`ChunkSet.schoolId` 改可空(null=平台官方全局集);**迁移 0022**(SQLite 整表重建,`PRAGMA defer_foreign_keys` 保证子表外键提交时成立,22 条迁移内存重放验证:数据保留、NULL 允许、外键无违例、school1 见本校+全局而 school2 只见全局)。VISIBLE(本校+全局)/OWNED(本校;超管加全局)两作用域——具体 schoolId 永不匹配 NULL 行→全局集对普通老师天然只读。导出 where 构造器+单测锁跨租户可见性(6 项)。

**#91 · 登录页加邮箱登录入口（增量⑥）** `[06-16 19:36]` 超管已设为脱离学校邮箱登录,但登录页没邮箱框→无处可登。`login-form` 加「学号/工号↔邮箱」模式切换(复用早存在未接线的 i18n),邮箱模式只渲染 email+密码。无后端改动(login 一直支持邮箱)。

**#92 · 超管平台首页 + 学校管理（增量⑦）** `[06-16 19:54]` 修「超管落在建校引导页、按钮把超管绑回学校」的矛盾。`dashboard` 对 SUPER_ADMIN 优先渲染平台首页、永不进建校漏斗;`platform-home`(全局题库入口+学校列表+新建);`createSchoolForPlatform`(建校不绑创建者);`createPlatformSchool`(超管限定、不改 session.schoolId)。131 通过。

**#93 · 官方题库扩到 B1/B2/C1（增量⑧）** `[06-16 20:15]` 口语线原只 Pre-A1→A2(偏初级),手编 9 套补到 C1,重点从音段转向超音段(重音/节奏/语调/连读)+职场/学术语域。SEED_ITEMS 7→16,沿用两种载体零架构改动;超管点一次「导入官方样题包」并入全局池(幂等)。

**#94 · 题库：导入 English Flow 2000 日常口语 chunk（增量⑨）** `[06-16 20:39]` 把《2000 Essential English Chunks》整本接入,每条 phrase/Means/Example 1:1 落三段式。`english-flow.ts`(2000 条,**仅服务端、不进客户端包**);`englishFlowSets()` 切 40 套×50;`importEnglishFlow`(超管、全局官方、按 source 去重、超时再点接着导)。134 通过。中文先留空待后续回填。

**#95 · 题库：通用题包导入（增量⑩）** `[06-16 23:36]` 超管界面「导入题包」:粘贴整包三段式、起名、填分级,自动按每套句数拆套、导入全局官方——**不再每个包改代码**。`splitIntoSets`/`slugHash`(CJK 名生成稳定 ascii 键);`domain/bank.importPack`(导入循环从 action 抽到 domain,顺带修分层评审 LOW)。137 通过。

**#96 · 题库导入改为有界可恢复（增量⑪/P1-a）** `[06-16 23:42]` 修评审 P1:导入不再单请求插全部(Workers CPU/子请求/时限会腰斩成半成品无回滚),改每次 ~600 chunk 预算+客户端循环续跑。`use-chunked-import.ts` hook(循环到 remaining=0、显「已 N 套」、幂等可恢复)。与 GradingJob 队列分工:导入有客户端驱动→客户端续跑;批改无客户端→队列。

**#97 · P1-b/c：英文数据集懒加载 + AI provider env 统一走 config（增量⑫）** `[06-16 23:46]` `englishFlowSets()` 改 async+`await import`(把 210KB 数据集移出急加载模块图、不增冷启动);`openai-compat` 不再直读 process.env,新增 `config.env(name)` 泛型读取,per-provider key/baseUrl/groupId 全经 config。3 条 P1 收口。

**#98 · 迁移树对齐 + CI 一致性校验（增量⑬/P2-a）** `[06-16 23:49]` `d1/migrations` 与 `prisma/migrations` 漂移一条(0018 时区修正只在 d1 侧,22 vs 21)。补 prisma 侧镜像(时间戳卡在 rate_limit 与 ai_key 之间);新增 `migrations.test.ts`(断言两套按逻辑名 1:1、无重名,CI 守住——今后缺失/多出即构建失败)。142 通过。

**#99 · 统一 domain 错误约定（增量⑭/P2-b）** `[06-16 23:58]` **细查有重要更正**:domain「错误通道」多数是有意设计——AI 不可用靠错误消息里「未配置/未实现」**哨兵字串**触发优雅降级,改 i18n key 会破坏 `isUnavailable`。正确做法是把隐式契约**显式化+集中+加测试**:`lib/ai/errors.ts`(`unavailable()` 工厂+`isUnavailable()`,5 处魔法字串 throw 收敛,**字串保持原样→行为零变化**);`errors.test.ts` 钉死契约(providers 串必须识别、真上游错误 401/429/fetch failed 必须不被吞)。

**#100 · 栈卫生：零成本 strict 加固 + Workers 类型收紧（增量⑮/P3）** `[06-17 00:03]` 只做安全无回归卫生项:tsconfig 开 3 个零 churn strict(noFallthroughCasesInSwitch/noImplicitOverride/noUnusedLocals);roster 类型去 Buffer(Workers 更安全);xlsx 供应链说明注释。**刻意推迟**(各自独立做,附理由):noUncheckedIndexedAccess(36 处)、ESLint 8→9、Prisma 生成器迁移等破坏性项。145 通过。

**#101 · 题库视频上传：暴露真实失败原因（增量⑯）** `[06-17 00:18]` 题库传视频是唯一没接 #76 诊断的上传路径(吞成笼统提示)。对齐 recorder:`!put.ok` 附状态码、catch 附错误名。

**#102 · 题库视频：所有查看者可同步预览播放（增量⑰）** `[06-17 00:33]` 详情页原只有上传控件(被 canEdit 挡住)、无播放器→除上传者谁都看不到。句集有 shadowVideoKey 时服务端 presignDownload 出播放地址,对所有可查看者可见(不受 canEdit 限);上传控件仍 owner-only。

**#103 · 题库系列：按系列分组 + 系列筛选（增量⑱）** `[06-17 00:45]` 加「系列」维度。`ChunkSet` 加可空 series(迁移 0023 纯增量);列表排序 series→name、加 series 过滤+`seriesList()`;写入(官方样题/Native English 2000/通用题包名);首页按系列分组(分区标题带套数+CEFR 范围)。⚠️ 存量 56 套需一条回填 SQL(部署后执行)。

**#104 · 题库 UI 重新设计：首页 + 详情页（增量⑲）** `[06-17 01:02]` 沿用现有设计语言。首页:顶部操作收成一个「新建/导入」下拉(4 按钮→1)、加搜索框、系列做可折叠分区卡;详情页:标题+徽章(系列徽章可点跳转筛该系列)→发布按钮置顶→视频预览→句子列表→「管理」分区(owner-only)。

**#105 · 题库老师端重做：手机竖屏优先、去冗余（增量⑳）** `[06-17 01:11]` 聚焦老师「找一套→发布」。老师只留「+新建句集」(官方全局可见、老师再导入只生成重复副本→移除老师端导入,超管保留 curation);列表竖屏优先(搜索置顶加高全宽、筛选横向可滚单行、系列默认折叠搜索时自动展开)。

**#106 · 面向全球第一步：App 加西班牙语 UI（增量㉑）** `[06-17 02:02]` 整应用支持西语,切换中/EN→中/EN/ES。`i18n.ts` 新增完整 es 字典(573 条,与 zh/en **1:1 对齐**,占位符全保留、空值键保持空);locale-toggle 三态循环;layout 支持 es。脚本校验 zh 573/en 573/es 573 两两差集为空。(题库内容只是 UI 本地化第一步;内容加西语释义是另一条线。)

**#107 · 取消邮箱验证要求（增量㉒）** `[06-17 02:50]` 去掉登录「邮箱未验证」拦截(它把任何设了邮箱却未验证的账号挡在门外,包括用学校+工号登录的老师)。login 移除拦截;register 注册即标记已验证。verifyEmail 等保留为无害休眠代码。(产品取舍:弱化账号安全换易用。)

**#108 · 上传遇到部署换版时提示刷新而非误报网络（增量㉓）** `[06-17 02:58]` 学生录题中途赶上部署→旧客户端调用对不上新版,Next 抛 `UnrecognizedActionError`,被笼统显示成「网络失败」误导。`lib/upload-error.ts`(`isStaleAction()` 识别、`uploadErrorText()` 友好文案),四处直传 catch 接入;`rec.staleReload` 三语(574/574/574)。进度不丢(每句即时上传、刷新后续录)。运维提醒:避免高峰部署。

**#109 · 老师可「学生视角预览」作业（增量㉔）** `[06-17 03:23]` 老师切只读预览核对学生看到的内容。`findForStaffPreview`(校内作用域、带 sentences+chunks、无提交);新路由 `/assignments/[id]/preview`(只读渲染、横幅、视频播放、要求展示,**完全不触碰学生提交组件**、对正在做作业的学生零风险)。preview.* 三语(581)。

**#110 · 学生可同时属于多个班级（增量㉕）** `[06-17 04:25]` 一生一班→多对多。设计:保留 classId 为主班级、额外班级进新表 `StudentClass`、可见性=主∪成员(存量单班不受影响、无需回填)。迁移 0024;`studentClassIds()`/`addClassMembership()`;`findForClass*`→`findForClasses*`(classId→classIds[]);resolveAttempt 用 classIds[] 鉴权;addStudent 学号已存在则加班级成员关系而非报错(同学号可加多班);删班只删仅属该班的学生。

**#111 · 学生班级成员关系彻底对等：删除 User.classId（增量㉖）** `[06-17 06:59]` clark 指出多班应**完全平等**、不该分主/额外。彻底对等化:成员关系**只**存 StudentClass、所有班平等。**迁移 0025**(先回填 classId→StudentClass `INSERT OR IGNORE`,再整表重建 User 删 classId 列/外键/索引,沿用 0003/0022 的 `PRAGMA defer_foreign_keys` 手法,表名行 id 不变、子表外键提交时成立,d1/prisma 逐字一致);session/CurrentUser 去 classId、studentContext 不再自愈。

**#112 · 首次登录改密页收集邮箱/手机号，并把强制改密覆盖到老师/管理员** `[06-17 07:02]` ①改密页(学生+staff 共用)加邮箱/手机两可选字段(预填已有、留空不覆盖、邮箱唯一校验),表单提取到 `change-password-form` 复用;②非学生且 mustChangePassword 登录后跳 /change-password,新增 `dashboard/layout.tsx` 守卫防深链绕过(改密页放 /dashboard 之外避免死循环)。

**#113 · 题库「英文/中文/中英文双语」三态显示开关（第一步：UI）** `[06-17 07:29]` clark 要 2000 条全译中文+三态开关,第一步先做 UI。`bilingual.tsx`(`ChunkLangToggle` 三态写 localStorage 跨页保持;`BilingualChunk` 按模式渲染三段、**中文缺失回退英文**;`BilingualChunkList`);学生跟读页二态→三态并补上原先没显示的解释句;老师详情页/预览页统一用共用组件;`lang.en/zh/both` 三语。本 PR 只做显示、不动数据。

**#114 · 官方题库回填中文：管线 + 刷新动作 + 首批 50 条（English Flow 0001–0050）** `[06-17 07:41]` 补中文数据+推生产机制。`english-flow-zh.ts`(按下标存中文译文、稀疏对象可分批追加,**巨大的 english-flow.ts 完全不动**、每批是干净小 diff);导入映射按下标 zip 中文(未译留空回退英文);super-admin 动作 `refreshEnglishFlow`(按中文覆盖数差异决定回填、幂等可续跑、`replaceChunks` 保留 set id 已发布作业不受影响、~600/次分批);首批 50 条;refreshPack 4 单测。

**#115–#120 · 回填中文 0051–2000（English Flow 第 2–40 套）** `[06-17 08:07~09:30]` 6 个翻译累加 PR,纯数据追加(管线 #114 已就位):#115 第 2–10 套 450 条(累计 25%)、#116 第 11–16 套 300 条(40%)、#117 第 17–22 套 300 条(55%)、#118 第 23–28 套 300 条(70%)、#119 第 29–34 套 300 条(85%)、**#120 第 35–40 套 300 条——2000 条全部译完 🎉**(100%,与 2000 条英文逐条对齐 FULLY COVERED)。每 PR 校验索引连续无缺、每条恰 3 段。上线后超管点一次「回填官方题库中文」推生产(幂等分批)。
**#121 · 加 R2 媒体导出脚本** `[06-17 12:27]` `scripts/r2-export.mjs`(零依赖、自实现 SigV4 用 AWS 官方测试向量校验、一条命令完成列举+下载+按「学号-姓名」整理+manifest.csv、可断点续传)+ 备选 `r2-organize.cjs`(整理 rclone 下好的文件)。仅在 scripts/、不参与构建。

**#122 · 加 R2 导出后按学生改名脚本** `[06-17 14:10]` `r2-relabel.mjs`:把 student-NNN 文件夹按 D1 名册就地重命名为「学号-姓名」(走 D1 HTTP API 取名册、零依赖)。

**#123 · 题库改名：English Flow → Native English 2000（增量㉗）** `[06-17 15:48]` 40 套官方题库句集名从「English Flow · NNNN」改为「Native English 2000 · NNNN」(与系列名一致)。**故意不动 source**(幂等键)和 series(改 source 会产生重复副本);迁移 0026 对存量执行 REPLACE。

---

## 阶段 9 · 多环节作业（#124–#137，06-17~18）★大特性

**#124 · 多环节作业·地基：Phase 环节表 + phaseId 回填（增量㉘ 第1段）** `[06-17 23:36]` 把作业从「扁平单一要求+单时间窗」升级为「有序环节列表」。两个架构决策:每环节独立提交+批改(可设仅练习不计分)、老作业自动转单环节(纯增量)。新增 `Phase` 模型(承载原挂在 Assignment 上的每环节配置 + 新字段 `graded`);**迁移 0027**(建 Phase 表、把每份现有作业回填成 order=1 环节逐字拷贝、三张子表 ADD COLUMN phaseId 回填)——**纯增量、不重建表、零数据风险**(与 0025 整表重建完全不同类)。本段应用代码不读 Phase、行为不变。

**#125 · 多环节作业·老师端：可增删改、排序多个环节（增量㉙ 第2段）** `[06-18 00:11]` 发布/编辑表单升级为多环节编辑器:有序「环节卡片」列表,支持添加/删除/上移下移,每卡设 标题/内容(题库套题或自由句子)/提交方式/说明/时间窗/次数/**计分开关**,序列化进 `phasesJson`;从题库套题发布时第 2 环节预设闭眼背诵。`createWithPhases`/`updateWithPhases`,**assignment 旧列镜像第 1 环节**→学生端/批改管线零改动、单环节逐字一致。

**#126 · 多环节作业·提交管线按环节（增量㉚ 第3段·地基）** `[06-18 00:38]` 最深最高风险段(无法本地真机回放+0025 教训)→拆地基/UI 两段。本段把提交/批改/练习管线**改为按环节但单环节逐字不变、不改界面**(bug 影响面锁在全新多环节作业)。**迁移 0028**:Submission 唯一键 (assignmentId,studentId,attempt)→加 phaseId,**仅替换唯一索引**(DROP/CREATE INDEX,无整表重建,better-sqlite3 重放验证);storage key 加 phaseId 段;resolveAttempt 改按 phaseId(以环节时间窗/次数为准)。

**#127 · 多环节作业·学生分段呈现 + 老师批改按环节（增量㉚ 第3段·收尾）** `[06-18 01:00]` 界面按环节呈现。学生端:`phase-submit.tsx`(渲染单环节提交流);作业页**单环节直接进流程、多环节渲染「环节清单」landing**(`phase-list.tsx`);新路由 `[id]/phase/[phaseId]`;首页卡片多环节显「已完成/总」进度、成绩取计分环节均分。老师端:批改页改为每(学生,环节)一行、多环节加环节徽章。单环节(=所有存量数据)逐字一致。无迁移。

**#128 · 作业菜单 + 看板统计可点开（增量㉛）** `[06-18 01:36]` 底部导航加「作业」入口→`/dashboard/assignments`(列该老师全部作业:课程·班级、截止、环节数、已交、待批 N 徽章);首屏三块统计改可点卡片(学生/班级→名单、作业→作业菜单);`listForStaff`+`pendingReviewByAssignment`。155 通过。

**#129 · 两处线上修复：作业菜单 D1 计数 + 闭眼背诵环节误渲染为跟读** `[06-18 02:31]` ①**闭眼背诵环节被误渲染成跟读**(clark 实测):凡「用套题」环节都带 shadowVideoKey+chunkSet,phase-submit 见到这俩就渲染逐句跟读、**忽略 requireEyesClosed**→闭眼背诵环节被当跟读。修:要求闭眼时一律走整段背诵流,只有「非闭眼+有套题视频」才逐句跟读。②**作业菜单用 D1 不支持的过滤 _count**(`_count.submissions.where`,全仓唯一一处,D1 适配器不支持运行时报错)→改 groupBy。

**#130 · 严重修复：编辑作业不再级联删除学生提交（按环节 id 就地更新）** `[06-18 02:44]` ⚠️**致命 bug(全程审查发现)**:老师打开任一作业编辑页点保存(哪怕一字没改),该作业**所有学生的视频/音频/分数/评语/练习被连带删除**(单环节也中招)。**根因**:`updateWithPhases` 每次编辑都 `phase.deleteMany` 整删再重建,而 Submission/PracticeAttempt/Sentence 的 phase 都 onDelete:Cascade→删环节=连带删提交;0027 已把存量提交挂到第 1 环节→对所有作业成立(与 0025 同类)。**修复**:按 phase id 就地对账(保留→in-place update 只换句子、id 不变→提交保留;新增→create;仅主动删的→deleteMany);phase id 一路打通 表单→action→domain→repo。新增 `assignments-update.test.ts` 回归(空改→一个都不删;删一个→只删那一个)。160 通过。

**#131 · 批改并发加固：fencing + 回收计次 + 不覆盖老师改分（审查·高）** `[06-18 02:55]` ①死循环回收:超 STALE_MS 被孤儿回收时原**不计 attempt**→崩溃任务无限重试每次烧 AI,改为回收计一次 attempt、到上限判死信。②**Fencing**:慢任务被回收又被另一 isolate 重跑→两份幽灵任务互相覆盖,所有终态写入加 `status:PROCESSING` 守卫(只有仍持 PROCESSING 的那次能结算)。③不覆盖老师改分:批改终态写入同样加守卫(并发老师改分谁先结算谁赢)。④已 GRADED 则跳过。残留:被回收时原任务仍在跑会有一次重复 AI 调用(双花),已被 attempts 封顶、分数不被覆盖。162 通过。

**#132 · 多环节统计·一：作业菜单/批改页计数按「人」计（审查·高/中）** `[06-18 03:02]` 「已交」改统计去重学生数(20 人×3 环节显示 20 非 60);批改页头「N 名学生」改去重学生数。待批维持按提交计(实际要批的条数)。

**#133 · 多环节统计·二：老师预览按环节呈现（审查·高）** `[06-18 03:13]` 预览原只读 assignment 镜像列(=第 1 环节)→多环节预览只显第 1 段、老师误以为预览了全部。改读 `findForStaffPreviewPhases` 逐环节渲染(各环节标题/计分/时间窗/视频/内容/提交方式)。

**#134 · 多环节统计·三：成绩册/学情/导出按环节汇总（审查·高）** `[06-18 03:19]` 最大一块:学情/成绩册/导出/薄弱句原把多环节作业塌缩成一个环节(丢其余)。统一「每环节为单位、再按计分环节均分汇总」(与学生首页同口径)。`latestPhaseSubmissions`(按 student:assignment:phase 取最新)+`collapsePhases`(计分环节 finalScore 均分);`weakSentences` 改按 (assignment,phase,order) 聚合(不同环节第 1 句不再混淆);导出/薄弱句复习同改。analytics.test +5。

**#135 · 稳健性批修：跟读 NaN/AI 超时/i18n/自愈连接（审查·中/低）** `[06-18 03:22]` ①跟读逐句 NaN(感知返回非数值,Math.max/min 不过滤 NaN→写 NaN 分,改 Number.isFinite 兜底 0)②AI provider fetch 无超时→加 AbortSignal.timeout(Gemini 生成 180s、上传轮询 60s 等,避免卡死占住 isolate=批改 15 分钟被回收诱因)③i18n replace→replaceAll(消除隐患)④看板自愈批改用新 getDb()连接。166 通过。

**#136 · 作业类型改为按环节设置（增量㉜）** `[06-18 03:54]` 老师反馈类型应在各环节选。`Phase.category` 已存在,接通表单:移除作业级类型、每环节卡选类型,作业级只剩标题+月份;`category` 从 AssignmentMeta 移入 PhaseDraft,`assignment.category` 镜像第 1 环节(展示不变)。无 schema 变更。

**#137 · 作业模板：发布可存为模板，本人/同校老师复用修改（增量㉝）** `[06-18 04:33]` 发布可存模板供复用。存:发布表单加「同时存为模板」+名称,存作业级标题+各环节配置(不含具体时间);用:「从模板新建」预填表单;共享:按学校(schoolId=null 平台级超管建全校只读)。**迁移 0029**(新增 AssignmentTemplate 表,payload 存 JSON,纯增量零风险);表单的 id 改可选(无 id=预填新建,有 id=编辑,模板预填与编辑复用同套表单)。166 通过。

---

## 阶段 10 · 体验大潮（#138–#165，06-18）★留存/教学闭环

**#138 · 体验·一：反馈闭环（出分预期 + 弱句直练 + 跟读逐句反馈）（增量㊞→㊴ 实为㉞）** `[06-18 05:57]` 学生体验 P0,闭合「做完→立刻知道结果→针对弱点再练」主线。**出分预期**:提交后改「AI 通常几分钟内出分,老师可能再复核」(原写「等待老师评阅」→学生误以为纯人工要等很久、当天不回来=最大断点);**弱句一键直练**(成绩页 AI 标⚠️弱句下「就练这 N 句」按钮→只含弱句的练习面板);**跟读逐句反馈**(此前跟读批完只有总分,现按句展示得分/弱句/「你读成:…」)。

**#139 · 体验·二：录制焦虑/上手提示批修（P1/P2）（增量㊟）** `[06-18 06:01]` 隐藏录制中违规计数(闪烁⚠️N 让低自信学生紧张,仅后台记录);权限失败给「怎么办」(去设置开权限/换新浏览器);成长卡可解释(平时=练习均分等);登录初始密码提示。

**#140 · 意见与建议：随时提交，积分奖励（增量㊱）** `[06-18 06:14]` 「我的意见和建议」:任何登录用户提交,每提交+10、被采纳+100(派生不存余额);超管审核队列(采纳/不采纳/重置+回复)。新增 `Feedback` 模型(迁移 0030 纯增量);`action-context` 加 `authedContext()`(任意登录用户)。

**#141 · 积分功能：在「我的」页展示积分，多来源派生（增量㊲）** `[06-18 06:26]` 积分搬到「我的」页顶部,从多行为派生(提交意见+10/采纳+100/完成作业+20/高分≥90+50/进步+15/练习+5/活跃日+5),展示连续打卡🔥(只在最近活跃日是今/昨才算、断一天归零、不计入总分保证单调)。`domain/points`(纯函数 tally+currentStreak 单测 7 例+computePoints);**完全派生无 schema**。171 通过。

**#142 · 体验·三：学生首页成绩趋势图（看见进步）（增量㊳）** `[06-18 06:34]` 「我的成长」卡加轻量成绩趋势条形图(近 10 次测试按时间、标与上次增减↑↓)。`ScoreTrend`(无第三方依赖 sparkline,柱高按数据自身区间缩放→小进步也看得见);复用 examScore 无新增查询、≥2 次才显示。

**#143 · 体验·四：录视频前流量提醒（增量㊴）** `[06-18 06:39]` 录制「准备」阶段视频模式加 Wi-Fi 流量提示(音频模式不显示),顺带缓解「上传慢以为卡死」焦虑。纯文案。

**#144 · 体验·五：多环节作业自动衔接下一环节（增量㊵）** `[06-18 06:47]` 交完一环节→1.8 秒后自动跳到「之后第一个未做且开放」的环节+醒目「继续下一环节:XX→」按钮。下一环节判定在服务端算;单环节无 next 行为不变;两套提交流都接入。

**#145 · 体验·六：学生端「我的薄弱点」个人画像（增量㊶）** `[06-18 06:50]` 把历次评分里反复出错的句子沉淀成画像。`/student/weak-points`(按准确度从低到高列薄弱句,每条含作业/准确度/出现次数,整行点进直达练习)。**完全派生不存表**,`studentWeakPoints`(纯函数单测 3 例,阈值<0.7、弱者优先取前 12、**phase-aware**)。174 通过。

**#146 · 体验·七：出分站内未读提示（红点 + 新成绩高亮）（增量㊷）** `[06-18 06:59]` 出分后主动提示(站内未读)。`User.scoresSeenAt`(迁移 0031 ADD COLUMN),gradedAt 晚于它的已批阅即「新成绩」:底部导航「作业」红点+首页「🎉 你有 N 个新成绩」横幅+作业卡「新成绩」徽章,进首页标记已看过。**完全派生**;标记 action 故意不 revalidate(留给当前这屏看完)。174 通过。

**#147 · 体验·八：测试真实性·强分层（正式测试防作弊）（增量㊸）** `[06-18 07:12]` 区分日常练习与正式测试(强分层)。环节级 `Phase.isFormalTest`,勾选后:强制真实录像(即使没勾视频发布时补 requireVideo)、记录切屏/退出违规(→FLAGGED 提示复核)、学生端「正式测试」横幅(明确规则→行为更端正=成绩更真实)。迁移 0032 ADD COLUMN;模板也带上;仅环节级不回填 Assignment。

**#148 · 体验·九：角色化导航 + 看板角色清晰（UX① 之一）（增量㊹）** `[06-18 07:35]` 四角色 UX 第一步(纯界面不改权限)。底部导航按角色裁剪(超管无学校→平台/题库/反馈/我的);看板角色徽章(校管·全校视角/教师·我的授课);教师管理卡仅校管可见;待批墙校管视角显示授课老师姓名。175 通过。

**#149 · 体验·十：学校管理员做成真角色·基础（增量㊺）** `[06-18 07:44]` 激活休眠的 SCHOOL_ADMIN(此前没任何地方设校管、role 默认 TEACHER)。**迁移 0033**:现有教职工全升 SCHOOL_ADMIN(谁都不丢权限);此后新教师默认 TEACHER;建校人自动成校管;校管可在教师管理里提升/降级。安全:`setStaffRoleInSchool` 限本校+仅 TEACHER↔SCHOOL_ADMIN(绝不波及超管/学生);`schoolAdminContext()` 守卫、禁止改自己防自锁。

**#150 · 体验·十一：结构性操作收口到学校管理员（B2·权限收权）（增量㊻）** `[06-18 07:48]` 把结构性/凭证类操作(renameSchool/导名单/班级 CRUD/学生 CRUD/重置密码/addTeacher)从「任意校内教职工」收到「仅校管+超管」(经 schoolAdminContext)。previewRoster 保持开放(只解析不写库);因 #149 已全升校管→对现有用户零影响,只对之后新增教师生效。

**#151 · 体验·十二：教师端隐藏管理入口（B3·界面收尾）（增量㊼）** `[06-18 07:51]` 收权后界面收尾:把普通教师管不到的入口按角色隐藏(导名单/建删班级/增删学生/重置密码/加老师/改校名),被降级教师得到干净只读体验。各组件透传 isAdmin。角色线完成(#148→149→150→151)。

**#152 · 体验·十三：批阅页减负——评分标准收起 + 违规标签说人话（UX②之一）（增量㊽）** `[06-18 07:56]` ①rubric 默认收起(只在「高级」时显示,多数老师不改、它是默认视图最大视觉负担);②违规标签「N 次离开」→「N 次离开录制」+修西语误译。**注**:审计提的「打开提交即自动跑 AI」特意没做(API 费用+可能误触,保留手动更稳)。

**#153 · 体验·十四：发作业表单·环节可折叠（手风琴）（UX③之一）（增量㊾）** `[06-18 08:03]` 发作业表单认知负担最大。没上风险高的「三步向导重写」,先做低风险:每环节做成可折叠卡片、同时只展开一个(手风琴),折叠显一行摘要。用 hidden 切换不动字段结构、零逻辑变更。

**#154 · 体验·十五：角色面板切换器（超管/校管/教师 来回切换）（增量㊿）** `[06-18 09:53]` staff 可在超管/校管/教师面板间切换(视角聚焦**不是提权**,始终≤实际角色、权限校验照旧)。`session.activeRole`+`panelRole`+`availablePanels()`(受角色上限+学校约束);`setActivePanel`(校验∈可用面板才写、绝不提权);看板/导航按 panelRole 取数渲染;教师只有自己面板无法越权(单测锁死)。180 通过。

**#155 · 体验·十六：发作业三步向导（基础→环节→确认发布）（增量51）** `[06-18 09:55]` 三步向导(仅发布流程,编辑保持单屏):①基础(对象+标题+月份)②环节(配合折叠手风琴)③确认发布(存模板+发布)。步骤指示器+上一步/下一步、发布按钮只在末步(避免前两步回车误提交);AI 备课只在第一步。180 通过。clark 这次四条全落地(面板切换/不做自动 AI/三步向导)。

**#156 · 体验·十七：班级分析更可读（at-risk 阈值说明 + 薄弱句标作业名）（增量52）** `[06-18 10:00]` at-risk 阈值说明(「测试均分<60 或提交率<50%」,取 RISK_SCORE/RISK_SUBMIT_RATE 常量口径一致);薄弱句标所属作业名。

**#157 · 体验·十八：批阅页显示「未提交」名单（增量53）** `[06-18 10:26]` 批阅页一眼看「谁还没交」(原只显有提交的学生)。取班级花名册减去有非草稿提交的=未提交集合,新增「未提交 N」卡(展开列姓名+学号催交)。纯派生无迁移。

**#158 · 体验·十九：题库「有视频」筛选 + 「最近用过」置顶（增量54）** `[06-18 10:31]` 「有视频」筛选(shadowVideoKey 非空、URL 驱动);「最近用过」置顶(`listRecentlyUsedByTeacher` 取该老师授课最近用的套题 Phase.chunkSetId 按 updatedAt 倒序去重 6 个,未筛选时置顶)。D1 不支持按关系 _max 排序→先读近期 phase 再 JS 去重保序。

**#159 · 体验·二十：at-risk 学生下钻个人详情页（增量55）** `[06-18 10:36]` at-risk 卡和花名册行可点进个人详情(逐次作业成绩/平时测试均分完成度/薄弱句)。新页 `students/[studentId]`(同校+同授课+学生在该班三重 scope,越权 404);`studentAssignmentScores`(纯函数单测 2 例);repo 加 *InOffering 单生单授课查询(不跨授课泄漏)。182 通过。🎉 四角色 UX 大轮收官。

**#160 · 体验·二一：仅练习不计分环节加「自由练习」开关（增量56）** `[06-18 13:40]` 「仅练习不计分」环节要不要进待批/算次数由老师勾选。`Phase.freePractice`(仅 graded=false 时显示「自由练习(不限次数、无需批阅)」):不限次数、AI 评完即定稿永不进待批。安全:domain 强制 freePractice && !graded;decideReview/shadow 在 freePractice 时 needsReview=false;resolveAttempt 跳过 maxAttempts。迁移 0034 ADD COLUMN。183 通过。
**#161 · 体验·二二：到期日/「今天截止」按用户本地时区（增量57）** `[06-18 13:46]` 「今天到期/已截止」按用户本地时区。`LocalDate`(把 dueAt 按浏览器本地时区渲染,原 `toISOString().slice(0,10)` 是 UTC 日国内差一天);看板「今天截止」用 `tzo` cookie + 纯函数 `localDayWindowUtc` 按本地日界算;`lib/time.ts`(单测 4 例)。「已截止」闸本就是时刻比较无需改。187 通过。

**#162 · 体验·二三：上手流程·名单模板下载 + 超管首登清单（增量58）** `[06-18 13:52]` 名单导入模板下载(`/students/template` 服务端 SheetJS 生成 xlsx,中文表头+示例行,不进客户端包);超管首登三步清单(建学校→题库导入→发学校码)。⚠️ 同时指出:**注册开放+学生知道学校码→用学校码自助加入为教师=越权风险**,需 clark 定安全口径(下条 AskUserQuestion)。

**#163 · 体验·二四：在线邀请老师·安全邀请链接（item 5a）（增量59）** `[06-18 14:02]` clark 选「安全邀请链接」。校管生成限时一次性邀请链接,老师凭链接设姓名+邮箱+密码加入(TEACHER)。安全:**只存 token 哈希**(DB 泄露也拿不到可用 token)、一次性(`markUsed` 以 usedAt:null 围栏,并发不都成功)、7 天过期。`SchoolInvite` 表(迁移 0035 纯建表);`/join` 公开落地页;生成入口经 schoolAdminContext。187 通过。

**#164 · 体验·二五：教师端细节·提交要求可视化 + 批阅快捷键（item 6a/6b）（增量60）** `[06-18 14:13]` 提交要求加图标(视频/音频/文字/拍照)、闭眼背诵仅勾视频时显示、底部实时预览「学生将提交:…」;批阅焦点页快捷键(←→ 切换/S 存并下一个/A 采纳/R 跑 AI,打字时不触发、Esc 关闭);核实班级名单本就卡片式无需改。

**#165 · 体验·二六：题库收藏星标 + 「我的收藏」置顶（item 6d）（增量61）** `[06-18 14:15]` 题库套题加星收藏、自动置顶。`BankFavorite` 表(per user×set 唯一,迁移 0036 纯建表,删用户/套题级联清理);`favoriteSetIds`/`toggleFavorite`/`listFavorites`;星标点击走 useTransition+router.refresh。187 通过。item 5/6 全完成。

**#166 · 体验·二七：邀请链接管理——待用邀请列表 + 撤销（P1）（增量62）** `[06-19 05:00]` 补 #163 的管理界面:校管查看本校待用邀请(未用未过期)+随时撤销(链接外泄可立即作废)。`listPendingForSchool`+`revoke`(限本校仅未用、deleteMany 围栏)。安全限制如实说明:只存 token 哈希→列表**不能再复制链接**(无法还原明文),只能撤销重发。

**#167 · 体验·二八：批阅页「把未提交标记为缺交」（P2a）（增量63）** `[06-19 07:27]` 批阅页「未提交 N 人」卡加「标记为缺交」按钮(不计 0,只标记)。新状态 `SubmissionStatus.MISSING`(status 列本是无约束 TEXT→**纯 Prisma 枚举改动、零迁移**);`createMissingMarkers`(首个计分环节建 MISSING 记录)、`markMissing`(花名册−有提交者,幂等);分析 isSubmitted/collapsePhases 排除 MISSING(缺交≠0 分、不计完成度/均分)。188 通过。

**#168 · 体验·二九：批阅页批量打分/反馈（多选）（P2b）（增量64）** `[06-19 09:52]` 按作业批阅页多选批改。每行复选框+全选条(可只勾筛选后可见的);批量条(统一分数+反馈、二次确认覆盖);`batchOverride`(staffContext 鉴权、最多 300 条、分数校验、仅填分数才置 GRADED);`applyBatchOverride`(单条 updateMany,以 assignment.offering.schoolId 多租户隔离,幂等)。188 通过。(注:此处的越权写入边界后于 #192/#193 加 teacher scope+测试。)

**#169 · 配置：本仓库默认模型固定为 Opus（增量65）** `[06-19 09:56]` 新增 `.claude/settings.json` 设 `"model":"opus"`(用别名指向最新 Opus),让各平台打开本仓库默认用 Opus。说明:effort/Ultracode 不是可提交字段,需各客户端单独开。纯配置。

**#170 · 体验·三十：名单导入失败行明细（增量66）** `[06-19 10:05]` 导入预览一眼看清「哪行、为什么」。加「行号」列(对应 Excel 行号);失败原因 i18n 化(roster 行级 error 产出 4 个 key,en/es 用户也看得懂);顶部汇总条「N 行有问题会跳过」+「只看问题行/全部」切换。189 通过。

**#171 · 体验·三一：消除日期首屏 UTC→本地闪现（增量67）** `[06-19 10:19]` `LocalDate` 原客户端算本地、服务端算 UTC,水合时跨日瞬间肉眼可见「闪」一下。修:让两端用同一时区偏移**确定性计算**(`formatLocalDay(iso,tzo)` 纯函数,`TzOffsetProvider` 注入偏移,去掉 suppressHydrationWarning);首访无 cookie 两端都用 0(UTC)仍一致不闪、真实偏移下次导航生效。191 通过。

**#172 · 体验·三二：题库套题发布前内嵌编辑（增量68）** `[06-19 10:27]` 发布页临发现错别字不用退回详情页改。发布页内嵌 `EditSetForm`+`updateChunkSet`(复用、零新逻辑),写回套题本身(单一来源);普通老师发布全局官方套题时不显示编辑器(与详情页只读一致)。191 通过。

---

## 阶段 12 · 结构化 Backlog P1–P4（#173–#188，06-19）

**#173 · 文档：建立待办 Backlog（A＋B 整理为预编号 PR 队列）** `[06-19 10:49]` 把 2026-06-19 全项目审计的 A 区(应用层打磨/补测)+B 区(已知限制/基础设施)待办,按专业判断拆分/合并,整理成预编号 PR 队列落 `docs/BACKLOG.md`(增量编号承接 68)。P1(69–73 纯应用层高价值)/P2(74–77 健壮性无需付费)/P3(78–81 较大或需产品决定)/P4(82–83 基础设施 epic)/Parked B4。合并 A2+A5、A7+A9;拆分 B6、A8;B3 上提到 P2。纯文档。

**#174 · 体验·三三：评阅链路失败可见化（增量69·P1，A2+A5）** `[06-19 11:00]` 两处静默失败可见化。A2:`autoGradeSubmission` 媒体 key 在却签不出 URL=「无录音硬打分」不可信降级→改 `markFailed`(可见状态)交持久重试队列(瞬时抖动自愈、持续失败停在可见的评阅失败);A5:`parsePerSentence` 的 catch 改 console.error(便于排查「已评阅却显示 0 准确率」),仍降级 [] 单行坏数据不影响整页。192 通过。

**#175 · 体验·三四：名单导入「未导入行」反馈（增量70·P1，A3）** `[06-19 11:09]` commit 阶段 createMany 撞唯一键回退逐行、逐行时「学号已占用」原**静默跳过**→老师不知是谁没进去。`importRoster` 返回 `failed=应建数−实建数`、摘要追加「N 行因学号冲突未导入」。区别于 skipped(预览阶段标红的格式问题)。193 通过。

**#176 · 测试·补关键单测：邀请 token 单次性 + 三个 domain（增量71·P1，A1）** `[06-19 11:22]` 纯补测试。repo/invites(用遵守 WHERE 语义的内存 fake 测真实单次性/过期:findValidByHash 拒已用/过期/错 hash、markUsed 只消费一次并发第二次被围栏挡、revoke 限本校未用);domain schools/staff/authoring(重名/重码/重工号/重邮箱报对应 key、authoring 四分支)。**217 通过(+24)**。

**#177 · 体验·三五：多阶段作业导出按环节拆列（增量72·P1，A4）** `[06-19 11:33]` 多环节导出原只给「各环节平均」掩盖各环节实际分。有多计分环节时为每个计分环节插一列分数、汇总列改名「总分·各环节均分」;单计分环节保持原 8 列不变。计分环节从已加载提交按 order 去重、无额外查询。220 通过。

**#178 · 体验·三六：项目自描述同步（aiConfigured + README）（增量73·P1 收尾，A7+A9）** `[06-19 11:38]` A7:`aiConfigured()` 原只看 GEMINI_API_KEY→只配 Qwen 等时误标 AI 关闭,改「任一 provider key 存在即已配置」;A9:README 把已落地项移到 ✅(接真实 AI、SheetJS、CI/CD)。221 通过。🎉 P1 全完成。

**#179 · 体验·三七：找回密码邮件不可用时如实告知（增量74·P2，A6）** `[06-19 11:48]` 找回密码原无论能否发信都返回成功,未配邮件时用户永远等不到链接。加 `emailConfigured()` 判断返回 `emailUnavailable`。**关键安全点**:该判断只看配置、不看账号是否存在、也不看单次发信结果→对所有邮箱响应完全一致(反枚举保持),已配置但瞬时失败仍统一返回成功。

**#180 · 体验·三八：后台评阅慢作业心跳防重领（增量75·P2，B3）** `[06-19 11:55]` 逐句跟读顺序分批跑,大套题整轮逼近 STALE_MS 被孤儿回收重领重复执行(有围栏不脏写但白花一次 AI)。`heartbeatJob`(每批之间刷新 PROCESSING 行 updatedAt,按 status 围栏不动别人的);`gradeShadowSubmission` 加 onBatch 回调每批心跳(避免 shadow→jobs 反向 import)。223 通过。

**#181 · 体验·三九：成绩单导出走轻量查询省内存（增量76·P2，B5）** `[06-19 12:02]` 成绩单导出一次拉全班提交、select 带体积大的 aiResult JSON,但成绩单 collapsePhases 丢弃逐句明细→aiResult 白拉。`listForOfferingGradebook`(同 where/排序但**不选 aiResult**,每行只剩标量大班从容)。没改成截断/分页(整班聚合截断会静默丢学生)。224 通过。

**#182 · 体验·四十：补全 PWA 真实图标（增量77·P2 收尾，B6a）** `[06-19 12:11]` 原只一张 icon.svg、purpose 写「any maskable」(iOS 主屏不认 SVG→退化占位;maskable 把无内边距的「你」字裁掉)。用 sharp 栅格化真实 PNG:icon-192/512(any 保圆角)、icon-maskable-512(满底缩字留安全区)、apple-touch-icon(180);manifest 拆 any/maskable;middleware 跳过规则扩到 icon-*.png。🎉 P2 全完成。

**#183 · 体验·四一：录制前一次性隐私告知与同意（增量78·P3，B6b）** `[06-19 12:33]` 采集前一次性隐私告知。`record-consent` 模态(采集什么/做什么用/按校留存,同意记 localStorage **按设备一次性**、私密模式失败静默降级);三个采集入口(录像/练一练/逐句跟读)统一接入,首次任意采集前弹一次之后不再弹。consent.* 三语。

**#184 · 体验·四二：视频留存定期清理（默认关闭）（增量79·P3，B6c）** `[06-19 12:44]` 按保留期定期删录音录像,**默认完全关闭**(不配置绝不删,避免任何部署静默清数据)。`sweepExpiredMedia`(取 createdAt<cutoff 仍有媒体的提交,先删 R2 再清 key,删失败保留 key 下次重试绝不留孤儿,有 limit 分批);**受保护路由 `POST /api/cron/retention`**(校验 Bearer CRON_SECRET,VIDEO_RETENTION_DAYS≤0 跳过);GitHub Actions 定时命中。**为什么不用 Cloudflare 原生 Cron**:OpenNext 下需自定义 Worker scheduled 入口(改 main、本地无法验证、贸然改有打断部署风险),命中受保护路由可验证可控。

**#185 · 体验·四三：Whisper 感知 provider 实接（增量80·P3，A8a）** `[06-19 12:54]` 占位 Whisper 接成真实:OpenAI 转写(audio→text)+文本对齐逐句打分(无视觉→无睁眼/人脸防作弊)。`whisperPerception.perceive`(R2 取录音 multipart 传 /audio/transcriptions、BYOK overrideKey、缺 key 抛 unavailable、带超时);纯函数 `recitationTokens`/`alignToReference`(CJK 按字拉丁按词、贪心消耗算 matched/expected,确定性可测,6 例)。

**#186 · 体验·四四：Claude 评分 provider 实接（增量81·P3 收尾，A8b）** `[06-19 13:01]` 占位 Claude judge 接成真实 Anthropic Messages API(x-api-key+anthropic-version 头、content 块响应)。`claudeJudge.judge`(复用 buildJudgePrompt+同一 JSON 约定、BYOK、缺 key unavailable、超时);**删除最后一个占位 StubJudge**——至此所有 provider/阶段均为真实实现(缺 key 各自优雅降级)。235 通过。🎉 P3 全完成。

**#187 · 基建·四五：后台评阅定时排空（安全 drain 版）（增量82·P4）** `[06-19 13:40]` 正式提交的后台评阅不再等人开看板。**受保护路由 `POST /api/cron/drain`**(校验 CRON_SECRET、runAfterResponse 踢一次 drainGradingJobs(10) 后快速返回);GitHub Action 每~5 分钟打一次;复用现有持久队列(退避/死信/心跳/幂等)。**为什么不用原生 Queues/不做 DO**:需自定义 OpenNext Worker queue()/scheduled 入口、无干净注入点、运行期无法本地验证、改错断所有部署,风险与收益不匹配(正式提交本就异步、分钟级延迟无感、秒级实时已由同步评的「练一练」覆盖)。235 通过。

**#188 · 文档：Backlog 结案，标注 P1–P4 完成进度** `[06-19 13:44]` BACKLOG.md 更新为「结案」:增量↔PR 对照(69→#174…82→#187)、P1–P4 各段标 ✅、重申限流 DO 与原生 Queues 有意不做。纯文档。

---

## 阶段 13 · 第二波全应用复审（#189–#212，06-19）

**#189 · 基建·四六：补全媒体清理覆盖面（增量83·审计 A1）** `[06-19 14:03]` 留存清理只扫 Submission 的 video/audio/image,**漏了**逐句跟读与练一练录音;题库套题视频删除时只删 DB 行把 R2 留成孤儿。补齐:留存 sweep 扩到三类(Submission 清 key 保留成绩、ShadowTake 删行+音频、PracticeAttempt 连行带媒体删);`deleteOwned` 回传 shadowVideoKey,deleteChunkSet 删库后删 R2。retention 测试 3→6 例。238 通过。

**#190 · 收尾·四七：README 刷新 + cron/storage 补测 + config getter（增量84·A2+A3+A4）** `[06-19 14:11]` A2:README adapters 不再写占位、加 Phase 4;A3 补测+8(两个 cron 路由鉴权门未配/缺/错 Bearer 一律 401、`storage.deleteObject` 200/404/403——用 403 而非 5xx 避开 aws4fetch 内置重试超时、config.videoRetentionDays 边界);A4:新增 openai/anthropic key/baseUrl 专用 getter。246 通过。🎉 审计 A1–A4 全收。

**#191 · 修复·四八：名单导入支持「专业无院系」（增量85）** `[06-19 14:37]` clark 上传的「学生点名登记表」复现:导入后专业/院系全空。**根因**:表把信息挤在「行政班」列(`专科2025司法信息技术2531320区队`),解析抽出专业「司法信息技术」+年级 2025+班号 2531320 但**没院系**;而 `Major.departmentId` 不可空、导入时「专业无院系就 continue 跳过」→专业建不出→班级关联不上。**修法**:`Major.departmentId` 改可空(onDelete SetNull);**迁移 0037**(SQLite 整表重建 NOT NULL→可空,`PRAGMA defer_foreign_keys`,**本地 D1 实测 apply 通过**);导入专业无院系也照建;4 处 `.department.name` 加 `?.`。247 通过。

**#192 · 安全·四九：修复校内按 id 越权（IDOR）（增量86）** `[06-19 15:08]` 全应用安全复审发现**校内 IDOR**:列表早按角色 scope(TEACHER 只看自己课头)但所有「按 id」明细/编辑/删除/评分/取媒体只按 schoolId scope→**同校普通老师可枚举 id 触达他人作业/课头/提交乃至学生视频**;最直接写入洞是 `applyBatchOverride`(按 id 批量改分、其 action 无老师归属校验)。按 clark 确认「每老师只管自己的」:repo 层每处「按 id」staff 读写统一 scope 到角色(assignments 5 处走 staffScope 经 offering.teacherId、offerings 6 处走 offeringScope、submissions findForStaff+applyBatchOverride 走 staffSub),TEACHER 限本人 offering、校管/超管全校;userId,role 贯穿 3 domain+22 调用方;新增 staff-scope.test。265 通过。

**#193 · 测试·加固：评分编排 + 逐句评分 + 越权写入回归测试（增量87）** `[06-19 15:23]` 全维度复扫:功能收口、i18n 三语 760 key 完美 parity、无 TODO/@ts-ignore。唯一缺口是最高风险路径缺端到端测试。纯补测试(3 文件+15 例):grading.test(autoGradeSubmission 编排/状态机 8 例:媒体签名失败→FAILED 不空评、自信→GRADED、老师分覆盖、低置信→送审、反作弊→FLAGGED、自由练习→定稿、未配置→回退队列、报错→FAILED);shadow.test(gradeShadowTake 6 例:0.7/0.3 加权、clamp、绝不 NaN、转写回退、unavailable);staff-scope.test(applyBatchOverride 写入路径老师 scope)。

**#194 · 可访问性·一：为无名表单控件补可访问名称（增量88）** `[06-19 15:44]` clark 选 a11y 方向。静态审查发现一批控件只有 placeholder 无可访问名(屏幕阅读器读不到、一输入就消失、盲用户只听到「编辑框」)。为每个无名控件补 `aria-label`,**复用各自既有占位/标签 key**(零新增 key、零视觉改动);覆盖 12 文件 26 控件。取舍:重复列表字段用 aria-label 而非 htmlFor(避 id 冲突);FormMessage 已带 role=alert 表单错误本就朗读(误报已排除)。265 通过。

**#195 · 可访问性·二：动态状态加 aria-live 播报（增量89）** `[06-19 15:54]` 学生录制/提交流程几处异步状态只有视觉不播报(盲用户听不到「提交中」「评分中」)。为一次性状态转换补 live region:submission-flow/practice-panel 块→role=status;photo-step 上传按钮 aria-busy+sr-only 播报;shadow-submit 逐句进度条→role=progressbar 全套 aria;recorder 3-2-1 倒计时→aria-live=assertive。**刻意不做**(正确决策):每秒跳的录制计时器不加 live region(逐秒播报刷屏淹没一切、反而有害)。

**#196 · 可访问性·三：弹窗焦点/键盘可操作性（增量90）** `[06-19 16:02]` 焦点/键盘整体审查令人放心(无正 tabIndex、focus-visible 齐全、无 autoFocus 滥用、交互元素都用语义标签),GradeFocus 已是标杆。两处真缺陷:`RecordConsentNotice`(键盘用户被困)补 aria-label/Esc 关闭/焦点移入+Tab 焦点陷阱;`BankActions` 下拉(只能鼠标点背景关)补 Esc/aria-haspopup/aria-expanded/背景层 aria-hidden。未强加 role=menu(会让 SR 期待方向键而这里是 Tab)。

**#197 · 运维：部署/运维 runbook（docs/OPERATIONS.md）（增量91）** `[06-19 16:08]` 部署知识散在 README/workflow 注释/config。新增 `docs/OPERATIONS.md` 照实记录当前真实机制(逐一核对 wrangler/package/config/4 workflow/registry):资源与绑定、一次性开通、**环境变量与密钥全表**(含 6 家 AI provider+BYOK)、部署流水线、迁移双轨与回滚、两个定时任务、密钥轮换矩阵、可观测性、**故障排查表**、灾备、部署后健康检查。README 加链接并修正过期桶名 recitations→hihomework。纯文档。

**#198 · 健壮性：补 not-found 与 global-error 错误边界（增量92）** `[06-19 16:17]` 两处标准 Next.js 健壮性文件缺失:没 not-found.tsx(坏链接落 Next 裸英文 404)、没 global-error.tsx(error.tsx 只兜根布局之下,根布局自身抛错白屏)。沿用 error.tsx「双语+不依赖 provider」做法补两个;global-error 整页替换文档不加载 globals.css→自带 `<html>` 用内联样式。顺带核实 sr-only 由 Tailwind 默认生成(#195/196 无隐患)。

**#199 · 界面：登录等 auth 页加极光渐变背景 + 补全 reduced-motion（增量93）** `[06-19 16:25]` clark 选「极光渐变流动」。`aurora-bg.tsx`+`.aurora` 样式(2–3 块品牌主色大尺寸模糊色晕缓慢漂移呼吸,**纯 CSS GPU 友好**、pointer-events:none、aria-hidden);挂在根布局 body 直接子节点仅 !user 时渲染(避开 main 入场 transform 困住 fixed 的坑、-z-10 盖在 body 背景之上内容之下);**顺手补全 reduced-motion**(原只关 3 个自定义动画,现 reduce 下把所有循环动画 pulse/spin/ping/极光停掉、过渡近瞬时——补上一轮 a11y 发现没覆盖的缺口)。265 通过。

**#200 · 测试·加固：权限变更守卫 + 删除越权回归（增量94）** `[06-19 16:30]` 继续挑真有价值安全回归。`role-guard.test`(`setStaffRoleInSchool` 是全应用唯一改角色的路径,断言只命中「同校+当前已是 TEACHER/SCHOOL_ADMIN」→学生提不成员工、超管改不动、不跨校);`staff-scope.test` 扩展(把 IDOR 回归延伸到 offering/assignment `deleteForSchool` 删前 scoped findFirst 按角色 scope)。**270 通过(+5)**。
**#201 · 界面：按页本地化标题（模板 + 三大着陆页）（增量95）** `[06-19 16:38]` 此前所有页面共用根布局同一标题(多标签分不清、屏幕阅读器播报页名一样、分享链接无页面信息)。根布局 `metadata.title` 改模板 `{ default, template: '%s · APP_NAME' }`;三大着陆页加 generateMetadata(服务端、复用既有 i18n key、随 locale 本地化):login→login.title、dashboard→nav.dashboard、student→nav.myWork。dashboard/student 本就 import getT、只多读一次 locale cookie不增 DB 查询。

**#202 · 界面：补齐其余页面的本地化标题（增量96）** `[06-19 16:44]` 接 #201,把 generateMetadata 铺到其余服务端页面:教职工导航(作业/教学/学生/题库/反馈/个人 用 nav.*)、auth 入口(重置密码 reset.title、验证邮箱 verify.title)。除少数客户端 auth 页(forgot 需拆壳)外主要可导航页面均有可区分标题。

**#203 · 性能：跟读音频预签名改并行（增量97）** `[06-19 16:54]` N+1/性能审计**结论很正面**:全应用查询纪律极好、热点页面全部正确批量化(Promise.all/findMany(in)/_count/groupBy/内存映射)、**无任何数据库 N+1**。唯一可优化处:`getShadowTakeUrls` 在 for 循环里逐条 await presignDownload(串行签名、句子多时延迟叠加)→改 Promise.all 并行(aws4fetch 签名是异步 Web Crypto 可重叠);保持按 take 顺序、单条失败跳过。270 通过。

**#204 · 界面：详情页动态标题（作业名 / 课程名）（增量98）** `[06-19 17:05]` clark 选的方向。接静态标题,给两详情页加随数据变化的标签:作业评阅页 `assignments/[id]`→该作业标题、课头页 `teaching/[offeringId]`→该课程名。`generateMetadata` 用 getCurrentUser(不在 metadata 触发 redirect)+**复用「按角色 scope」finder**(findForSchool/findForSchoolWithCourse,与页面同样归属校验、**杜绝凭 id 把别人的作业名/课程名泄进标签**沿用 #192 IDOR 守卫),取不到回落通用菜单名。

**#205 · 界面：动态标题延伸到学生作业页与师生详情页（增量99）** `[06-19 17:11]` 接 #204 再铺两处:老师「某学生」页 `students/[studentId]`→学生姓名(无名则学号,按校 scope)、学生作业页 `student/assignments/[id]`→作业标题(按学生自己班级 scope,凭 id 猜不到班外标题)。两处复用与页面相同的归属 finder、取不到回落。

**#206 · 界面：主要路由加载骨架（loading.tsx）（增量100）** `[06-19 17:17]` D1 查询有真实延迟,页面跳转时内容区在数据返回前空白。给底部导航主要目的地加 Suspense 加载骨架(跳转即时显 shimmer 占位、外壳不动只换内容区)。`PageSkeleton`(复用 .skeleton shimmer、reduced-motion 下自动静止、骨架条 aria-hidden+一个 sr-only role=status 播报「加载中」);6 个 loading.tsx(dashboard/student/dashboard 下 assignments/teaching/students/bank)。

**#207 · 界面：补齐 feedback / profile 的加载骨架（增量101）** `[06-19 17:22]` #206 给六个 dashboard/student 下目的地加了骨架,但底部导航还有两个顶级路由漏了(`/feedback`/`/profile` 不在 dashboard 段下、无父级 loading 边界、跳转仍空白)。补这两个 loading.tsx。至此底部导航全部 8 个目的地都有骨架。(详情页如 assignments/[id] 已由父段 loading.tsx 自动覆盖、无需重复——那才是冗余。)

**#208 · 测试·加固：班级删除的孤儿清理 + 租户 scope（增量102）** `[06-19 17:27]` `deleteWithStudents` 是全应用**唯一会删学生**的数据完整性分支(删班级时仅当该班是某学生最后一个班才连人删,否则只解除关联),回归会丢学生/留孤儿却无测试守。新增 `classes.test.ts`(5 例:班级不属本校→不动且 findFirst 按 {id,schoolId} scope、唯一班级→删、还在别班→只解关联、混合→只删孤儿子集、空班→跳过孤儿查询不误删)。275 通过(+5)。(增量85 的「专业无院系」已由 roster.test 覆盖不重复。)

**#209 · 文档：BACKLOG 记录第二波打磨（增量83–102）** `[06-19 17:32]` BACKLOG.md 进度停在增量82,其后第二波复审产出 20 个增量未记。补一节「第二波(增量83–102)」表格+PR 对照(PR#=增量#+106),并记下复审中判为「非问题/已覆盖/有意不做」的项(预签名/SSRF/注入 0 critical、无 N+1、analytics/roster 已充分、upsertCourse 同义反复不补测、Parked B4 仍待触发)。纯文档。

**#210 · 文档：全部 PR 复盘（docs/PR-REVIEW.md，#1–#209）** `[06-19]` 应 clark 要求整理全部 PR 复盘,按 14 个阶段组织(MVP→五段式重构→题库→分层重构→安全/评审→AI/BYOK→全球化/中文回填→多环节作业→体验大潮→Backlog→第二波复审),每阶段含「做了什么/有什么用/可改善空间」+逐个 PR,附横向「最值得改善」总结(测试深度、授权集中化、可观测性、CI 门禁、AI 层校准)。纯文档。

**#211 · 测试·集成：仓储/领域层对真实 SQLite 的集成测试（增量104）** `[06-19]` 复盘里点名**回报最高**的缺口:此前全是单元测试(mock prisma)、断言 where 形状、对真实数据库零验证(两次数据级 bug #130/#192 都事后补测)。引入集成测试层用真 SQLite 跑真 SQL:`harness.ts`(把全部 37 个 d1/migrations 重放到临时 SQLite 文件**顺带验证迁移对真引擎合法**、经 @prisma/adapter-better-sqlite3 接真 PrismaClient、开 PRAGMA foreign_keys 测真级联);`scoping.test`(4 例用真数据证明 IDOR 边界:老师按 id 读不到别人作业/课头/提交、校管全校、无人跨校);`db-behaviors.test`(真实 ON DELETE CASCADE 的 deleteWithStudents、以及 `acceptAiForAssignment` 的 raw SQL——此前因「mock raw SQL 无意义」刻意没测,真引擎验 COALESCE/状态守卫)。新增 3 个**仅测试用** devDep(better-sqlite3 等,不进生产包,生产仍走 D1 adapter)。282 通过(+7)。E2E(浏览器)需可运行 Workers+D1+R2 难做成可靠 CI 门禁→先落地集成层。

**#212 · 测试·集成：名单导入对真实 SQLite 的端到端测试（增量105）** `[06-19]` 接 #211 harness,给最具关系性的写入路径(名单批量导入 domain/roster.ts)补真实数据库端到端测试(3 例):关系建对(院系/专业/班级/学生/成员按正确外键落库)、增量85 端到端(「有专业无院系」→专业以 departmentId=null 真落库不丢)、幂等(重复导入只更新不新建、唯一约束守住零重复)。285 通过(+3)。

---

## 横向「可改善空间」总结（最值得投入）

1. **测试深度** —— 此前全是单元测试(mock prisma)、只断言 where 形状;**#211/#212 已补上对真实 SQLite 的集成测试**(IDOR/跨校隔离/真级联/raw SQL/名单导入),但仍**无浏览器 E2E**(登录→提交→批改主流程)。两次数据级 bug(#130 级联删提交、#192 IDOR)都是事后补测——继续扩集成 + 加最小化 E2E 是回报最高的投入。
2. **授权集中化** —— IDOR 修了两次(#28、#192)。可把「按角色/租户 scope」抽成**统一策略 + 默认拒绝 + 全覆盖回归**,而非逐 finder 加 teacherId。
3. **运行时可观测性** —— 有 wrangler tail + observability,但无错误聚合(Sentry 类)、无真实用户监控。线上问题靠日志人肉排查。
4. **CI 门禁** —— 只有 lint+tsc+test+build,无 SAST、依赖漏洞扫描(Dependabot)、bundle 体积预算、a11y 自动检查(axe)。
5. **AI 层** —— 模型 id 写死(registry)会随厂商更新过期;置信度阈值(0.85)/逐句权重(0.7·0.3)是经验值、缺真实数据闭环校准;provider 失败可观测性较弱。
6. **时区/日期** —— 反复出 bug(#73/74/75/161/171)后已统一,建议沉淀为「一处时区工具+测试」长期守护。
7. **内容/i18n** —— UI 三语(zh/en/es)但题库内容仅中/英;2000 句回填用 7 个 PR、数据录入类工作可脚本化。
8. **刻意取舍**(非缺陷,均已记 tradeoff):原生 Cloudflare Queues/DO 有意不做(可验证性优先)、定时任务走 Actions cron(分钟级漂移)、取消邮箱验证(易用优先)、防作弊仅前端提示。

## 一句话结论

4 天 212 个 PR,从 0 到一个**功能完整、架构分层干净(action→domain→repo)、安全/可访问性/运维/性能/测试都收口**的多租户教育应用。最大结构性短板曾是「缺集成/E2E 测试与运行时可观测性」——集成测试已于 #211/#212 补上,**最小化 E2E 与运行时可观测性是下一步回报最高的投入**。
