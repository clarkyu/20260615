# 会话存档 2026-07-12:批阅系统重构五单收官 + 班级展示全站规范

> 下次恢复入口:读本文 + `CLAUDE.md`「当前已知状态」。上一轮存档:`docs/SESSION-2026-07-11-RECOVERY.md`(雨课堂名单匹配)。
> 批阅系统的完整历史(13 坑/成本危机/死信治理):`docs/GRADING-BACKLOG-2026-07.md`。

## 一、批阅系统重构五单(全部合并部署)

起点:clark 要求全面复盘批阅(Gemini 感知 + DeepSeek 判分、429 墙等)并从机制层面重构;
专业意见已确认:**即时受理 + 透明进度 + 可靠的事后评阅**是正确架构(workerd 响应后 ~30s 终止、
外部 AI 抖动、教学上也无需秒级出分),不做即时评阅。五单队列由 clark 全选确认,按序交付:

| 单 | PR | 内容 | 关键文件 |
|---|---|---|---|
| 置顶 bug | #453 | 「提交成功后又显示未提交;长视频提交不成功」:R2 multipart 分片上传(>8MB,逐片重试)、录制 5 分钟自动停(`MAX_MEDIA_DURATION_SEC=300`)、finishSubmission 网络重试×2、探针复测 `resilientProbe`(瞬时 404 不误拦)、「已录制未提交」续交横幅 | `lib/storage.ts` `domain/submit.ts` `recorder.tsx` `submission-flow.tsx` |
| B 自愈闭环 | #454 | `classifyGradingError` 四类(rate/permanent/not-ready/transient)差异化退避:429 长退避 10min×2ⁿ、损坏立即死信不烧钱、未就绪 30s 短退避;`maintainGradingJobs`(cron drain 每班先跑):平台级幽灵对账 + 可救死信满 6h 自动复活一次(`[auto-requeued]` 标记防循环,cap 20/班) | `domain/jobs.ts` `api/cron/drain/route.ts` |
| A 进度透明 | #455 | 学生端「排队中→AI 评阅中→自动出分/本次由老师评」:`domain/grading-progress.ts` 纯函数单一口径,`GradingProgress` 组件 10s 轻轮询、出分 router.refresh;**FAILED 归入已提交**(修「评阅失败显示成未提交」残留根因) | `grading-progress.ts(x)` `phase-submit.tsx` 两条提交流 |
| D 即时拒收 | #456 | 提交定稿时读对象头 16 字节验容器魔数(webm/mp4/ogg/wav/mp3),全零/截断/垃圾当场拒收重录;保守一票否决,读不到头放行;逐句跟读明确不加(子请求上限,评阅侧 permanent 兜底) | `lib/media-sniff.ts` `storage.readObjectHead` `domain/submit.corruptRequiredMedia` |
| C+E 收官 | #457 | 排空次序:三泳道(submission/shadow/writing)轮转配额 + 泳道内截止已过/24h 内优先(`fairOrder`);诊断页死信画像(按错误类分布+已复活数)+ 停摆告警(最老待评逾 60 分钟) | `domain/jobs.ts` `repo/diagnostics.ts` 诊断页 |

防线全景(四道门):录制中客户端校验 → 上传后完整性探针 → 提交定稿魔数嗅探 → 评阅时 permanent 分类 + 归档扫帚。
自愈全景:差异化退避 → 幽灵对账自动化 → 死信自动复活一次 → 泳道公平排空 → 可观测画像/告警。
**运维含义:死信只剩真坏媒体,不再需要人工点 Actions 按钮捞。**

### 附带根治:集成测试「偶发失败」顽疾(困扰多个会话)
真凶是 `harness.ts` 模板库文件名用 `process.pid` 命名,PID 被系统回收复用时撞上残留模板 →
迁移重放报 `table already exists`;重跑换 PID 就好,一直被误当并发 flaky。修复 = 建模板前先删残留
(#457 内)。修后全套 811 用例连跑两遍全绿。**以后全量跑挂了先怀疑真问题,别再甩锅 flaky。**

## 二、班级展示全站规范(#458 + #459,均已合并)

clark 口径(2026-07-12 定,全站):**凡涉及班级的操作/展示——每班独占一行、按班级序号升序、
班级名后带学生人数**。统一比较器 `lib/class-sort.ts`(`compareClassName`,numeric-aware:"9班"<"10班");
人数后缀 i18n 键 `class.size` ×3 语(zh「（57人）」)。

- **#458**:成绩档案页第一批——环节班级行/雨课堂块/期末总评块 一班一行+升序。
- **#459**(三批次):②其余界面收尾(作业列表/看板待批[原按待批数降序]/诊断页/新建课头多选
  [原 grid-cols-2]/发布多选×2/学生端总评卡/授课筛选下拉);③班级名带人数(数据侧补
  `offering.classId`,`classSizes` 聚合逐页接线;班级管理页已有不动;**学生端本人班名暂不加**);
  ④档案页入口调整:「导入雨课堂数据」挪进雨课堂块、「期末阶段总结」→「期末总评」、
  「导出学校平台成绩文件」→「导出登分册」。
- 涉班改动的既定改点:批次内班级排序在 `groupAssignmentBatches` 源头(作业列表/看板/归并页共用);
  新增涉班界面一律用 `sortByClassName` + `class.size`。

### 误合并插曲(记录处置口径)
clark 误合并 #458 → 点了 Restore branch + Revert 按钮又都没继续。处置:**#458 保留生效**(自身完整、
测试全绿,无需撤销);restore 的旧分支被 force-with-lease 覆盖复用;`revert-458-…` 残留分支
**待 clark 在 GitHub 删除**(App 令牌无删分支权限)。

## 三、档案页统计口径答疑(clark 两问,已核实)
- 「X/Y · 已评 N」:X=提交**份数**(重做各算一份,可>班人数),Y=班级人数,N=已评份数。
  两次训练与期末考核**已交的 100% 评完**;「没评完」观感来自缺交学生(X/57 的缺口)。
- 期末环节 1「题目选择」是选题分流环节,**不评分**,永远显示「已评 0 · —」,正常。
- 如要改成「按人数统计(每人只算代表性一份)」是口径改动,clark 说一声再做。

## 四、Google API 费用申诉(2026-07-12 补稿)
$768 账单(2026-07-07 成本危机,用量真实)此前只留了策略、没写邮件。本轮已给 clark 起草
**goodwill credit 申诉邮件**(英文全文在会话记录中):定位「一次性批处理误配置的善意减免」,
主张单日尖峰 ~$500 优先、绝不称计费有误、绝不 chargeback(封号风险);列四项已落地的护栏
(控制台硬上限 $555/应用级日限 $50/换低价模型/AiUsageLog 真账本)。入口:Cloud Console →
Billing → Help → Billing questions。**发送与否在 clark。**

## 五、挂起/待办
- **task #48(挂起,等 clark 拍板)**:待批全部转正——9 环节 accept-ai + ~44 份无 AI 分残留
  (2531326 零参照句问题,clark 曾叫停;继续前需定残留处理:转人工/硬评/维持)。
- **clark 手动收尾**:删 `revert-458-…` 分支;逐班重导 8 个雨课堂文件(吃 #450 新匹配)→
  工作台填 60/免计 → 发布 → 导出登分册;Google 费用申诉邮件按需发送。
  导入直达链接见 `docs/SESSION-2026-07-11-RECOVERY.md`。
- 学生端本人班名要不要也带人数:未做,等 clark 表态。

## 六、操作备忘(本轮验证有效)
- 每个新 PR 前:`git fetch origin main && git checkout -B claude/confident-cray-1hhkal origin/main`;
  合并后远端分支若被 GitHub 自动删除,`git fetch --prune` 后普通 push;若被 restore 且只含已合并
  历史,force-with-lease 覆盖。
- mcp actions_list 结果 ~370k 超限:存文件 → `jq -r '.workflow_runs[0]…'` 提取 → 删文件。
- python heredoc 写文件:`"\\n"` 会写成字面反斜杠 n,用真实换行或读回替换。
- **容器会被回收:重要产出别只留在工作区,尽快 commit+push**(本档第一版就曾因此丢失重写)。
