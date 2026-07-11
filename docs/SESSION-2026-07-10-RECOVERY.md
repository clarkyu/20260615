# 会话恢复档 · 2026-07-10（学生成绩档案主线收官 + 雨课堂全链路上线）

> 目的:下次会话完整恢复本次上下文。本轮主线 = **学生成绩档案 / 学期总评**从 PR1 一路做到
> 雨课堂原始数据透出,**#437–#448 共 12 个 PR 全部合并部署**。接续上一轮
> `docs/SESSION-2026-07-09-RECOVERY.md`(评阅收尾 + 雨课堂方案 v3)。
> **恢复时先读 §4「仍在 clark 侧的手动操作」——那是唯一还没收尾的活。**
> 相关旧档:`GRADING-BACKLOG-2026-07.md`(评阅运维总账)、`OPERATIONS.md`§6(维护端点按钮)、
> `ARCHITECTURE.md` + skill `system-architecture`(分层)。

---

## §1 本轮已交付(全部合并 + 部署成功)

学期总评 / 成绩档案主线,严格分层 `app→actions→domain→repo→prisma`,每 PR 全绿(lint 0 / tsc clean / vitest)。

| PR | 内容 | 关键文件 |
|---|---|---|
| #437 | 数据层:总评三表 + 雨课堂两表(纯建表,双迁移树) | `d1/migrations/0063_semester_review.sql`+`0064_class_perf.sql` + prisma 孪生;`schema.prisma` 5 新模型 |
| #438 | domain 纯函数:总评聚合/快照/diff + 雨课堂解析 + 课堂表现公式B | `lib/domain/review.ts`、`lib/rain-classroom.ts`、`lib/domain/class-perf.ts` |
| #439 | 老师工作台:比例即时重算 + 逐格改分/免计 | `repo/review.ts`、`repo/class-perf.ts`、`domain/review-load.ts`、`review/page.tsx`+`review-client.tsx` |
| #440 | AI 推荐比例:聚合零PII → DeepSeek 严格JSON → 老师确认生效 | `domain/review-advice.ts`、`ai/advice.ts`、`ai/providers/openai-compat.ts` |
| #441 | 一键发布:不可变快照/版本/撤回/diff 预览(及格翻转名单) | `domain/review-publish.ts` |
| #442 | 学生档案页:只读已发布快照,本人行+匿名班级对比 | `app/student/review/page.tsx`、`extractStudentView` |
| #443 | 「空缺/0分 填60」一键批量(带标注、可逐格还原) | `fillSixtyTargets`、`FILL60_REASON`/`FILL60_SCORE=60` |
| #444 | 雨课堂导入链路:上传 xlsx → 预览对账 → 落库 → 课堂列点亮 | `domain/class-perf-import.ts`、`actions/class-perf.ts`、`review/import/` |
| #445 | 学校平台成绩导出:模板回填三列,行列保真 | `domain/review-export.ts`、`review/export/`+`export/download/route.ts` |
| #446 | 导出对抗复核 7 项修复 | 见 §3 |
| #447 | 成绩档案独立页 + 底部导航入口(师生两侧) | `app/dashboard/review/page.tsx`、`components/bottom-nav.tsx` |
| #448 | 雨课堂原始数据透出:老师全班明细页 + 学生「我的课堂记录」 | `domain/class-perf-view.ts`、`review/classroom/`、`components/rain-detail-table.tsx` |

**部署对应**:#437→部署略;… #444=deploy #~;#445=deploy #435;#446=deploy #436;#447=deploy #437;#448=deploy #438(均 success)。
main HEAD = `8a9568b`(#448)。suite 763 passed(截至 #448)。

---

## §2 架构关键点(改这条线必读)

- **单一算术源** `lib/domain/review.ts` 纯函数:`categoryAuto`/`effectiveCategories`/`computeTotal`/
  `assembleSnapshot`/`diffPublish`——工作台客户端、发布、学生页**共用同一函数族**,口径不分叉。
- **草稿读时现算、不落库**;只有「发布」落不可变快照 `SemesterReviewPublish`(每版一条,`@@unique(offeringId,version)` 防并发)。
- **多租户边界**全在 `repo`:`offeringScopeFor(schoolId,userId,role)`;写操作(upsert 类)由 action 先
  `offeringRepo.findForSchool` 验归属再调(与 grading override 同模式)。
- **课堂表现公式 B**(`domain/class-perf.ts`):4 信号全二值、按「当天该功能是否开放」归一、死信号剔除重归一、
  到课率≥80% 保底 60。追溯宽松预设 `CLASSPERF_LENIENT_WEIGHTS = 70/10/10/10`(本批 3–6 月数据 7 月才定规则)。
- **雨课堂解析**(`lib/rain-classroom.ts`):重开课「（N）」后缀**先判**再前缀匹配;题目列按**列索引**收集;
  答过=trim 非空≠未答题;重复学号逐节合并(到课 OR、计数 SUM)。
- **导出取分**=工作台**当前生效分**(auto+改分/免计/填60)四舍五入取整;**无分留空不写 0**(0 会被平台当真实分);
  列映射(clark 定死):**平时=课堂表现(雨课堂)、实验=训练、期末=期末考核**;总评列留空,学校平台自动合成。
- **原始数据透出**(`domain/class-perf-view.ts`):`buildStudentRow` 汇总口径与公式B分母**完全一致**(只数计次节、
  答题分母只数有题节);`pickRowPerOffering` 学生端每课头择版(钉住优先、失踪回落最新);学生端 repo 按 `userId` 过滤(隐私边界)。

---

## §3 #446 对抗复核 7 项修复(minors 成绩零容忍,已上线)

导出线合并前跑了三视角复核 workflow + 反驳验证,落地修复(全在 `domain/review-export.ts`,有单测钉住):
1. **无分必须显式清空**:模板预填 0 / 老师复用已填文件时,`v==null` 走 `delete ws[addr]`(不留旧值当成绩)。
2. **格式保真** `cellNF:true`:回写保留数字格式(z),否则日期/前导零学号列变裸数、非成绩格被静默改、平台按显示文本读会错位。
3. **学号按显示文本(w)匹配**:数值型学号带前导零格式时 v=123 显示 00000123,花名册存显示文本——按 v 匹配必落空。
4. 预览/下载**同一端点同一代码路径**(`export/download/route.ts` mode=preview 回 JSON,否则回附件 + `X-Export-Report` 计数头)。
5. 客户端**过期响应丢弃**(seq 序号,换文件作废在途预览)。
6. 下载后**计数与预览比对**,期间改分/换导入 → `rexp.warnChanged` 警示。
7. 10MB 本地即拒。

---

## §4 仍在 clark 侧的手动操作 ⚠️(需老师登录会话,Claude 替不了)

**8 个班雨课堂数据已全部导入生产库、逐班核验通过(共 394 生)。** 剩余只有老师侧界面操作:

1. **每班点「空缺/0分 填60」**——学期总评工作台配置面板的按钮。查生产库(2026-07-10):全库仅 offering 9(2531327)
   有 12 个手工改分格(clark 手改:课堂1/训练10/期末1),**8 个班都还没点过填60**(`reason LIKE '[统一填60]%'` 计数=0)。
   ⚠️ 注意:填60 只填**无分或 0 分**的格;训练只交一次的 34/44 这类**折半分不是 0、不在范围**。若要这类低分也保底,
   是另一条规则(如「训练列<60 抬 60」),需 clark 明确、再加选项。
2. **顺序**:先填60,再「导出学校平台成绩文件」。导出取实时生效分,已导出过的班填完要重导。
3. **导出流程**:学期总评/成绩档案 → 「导出学校平台成绩文件」→ 上传学校模板 xls/xlsx → 预览核对(未匹配/缺分名单)→ 下载 → 导入教务系统。

**「导出不对」两次误报均已排除**:(a) 2531327 是 #446 部署前的**旧版程序**生成(旧版有 0/旧分残留缺陷),强刷后重导即对;
(b) 2531320 逐格核验 57/57 与雨课堂公式重算一致,clark 「我搞错了」。→ 若再报导出不对,先确认是否 #446 部署后重新下载的。

---

## §5 offering ↔ 班级对照(本轮 d1-query 得)

导入台账(ClassPerfImport)每班一次(2531322 导了 3 次用最新):

| offeringId | 班号 | 学生 | 匹配 | 未匹配 |
|---|---|---|---|---|
| 9 | 2531327 | 42 | 38 | 4 |
| 10 | 2531321 | 50 | 49 | 1 |
| 11 | 2531324 | 54 | 53 | 1 |
| 12 | 2531325 | 40 | 40 | 0 |
| 13 | 2531320 | 57 | 57 | 0 |
| 14 | 2531322 | 52 | 52 | 0 |
| 15 | 2531323 | 58 | 54 | 4 |
| 16 | 2531326 | 41 | 40 | 1 |

雨课堂预估均分(宽松权重):2531320=87.0 / 2531321=83.6 / 2531322=85.9 / 2531323=79.1 / 2531324=80.5 /
2531325=75.0 / 2531326=71.0(保底救起3) / 2531327=72.4。计次节数每班=平台声明数,全对上。

---

## §6 上一轮遗留(仍未收尾,低优先)

`docs/SESSION-2026-07-09-RECOVERY.md` §2「待批全部转正」残留(task #48):
- **非正式作业 ord1(25份音频)+ ord2(17份视频)** class 2531326 的 assignment **0 参照句** →
  autoGradeById null-settle,clark 已**暂停**这条线。选项 A(填60端点)/ C(补参照句)已记录在旧档 §2。
- **坏视频 sub 31723**(桑杰巴珠,2531324,学号 80254006,Native 5月环节2,Gemini 400 视频损坏)→ clark 已在评分页手动处理成 GRADED。
- 这些与成绩档案主线无关,不阻塞。

---

## §7 硬约定(CI 会拦,改代码前记牢)

- **PR 只由 clark 合并**;Claude 给 draft PR + 链接 + 一句话,**绝不自合**;等合并再继续下一步。
- **改 PR 前先 reset 分支到 origin/main**(`git checkout -B claude/confident-cray-1hhkal origin/main`)——#440 曾因忘记 reset 撞冲突。
- 双迁移树逻辑名 1:1 配对;i18n zh/en/es 键全等(test 强制);actions/** 不许 import prisma;env 只走 config.ts;
  日志只记密钥有无不记值;model ID 不进 commit/PR/代码。
- 运维走 Actions 按钮:`d1-query.yml`(只读 SELECT)、`admin-call.yml`、`grading-drain.yml`;d1-query 最小披露(聚合优先、无学生 PII 除非老师可操作)。
