# DECISIONS

记录 SPEC 未覆盖之处的实施决策(SPEC §0:选最简单可行方案并记录,不停下等确认)。

## D1 仓库落位(2026-08-26)
实施环境可推送的仓库仅 `clarkyu/20260615`,故 zsb-qbank 以**子目录**形式进入该仓库
(独立 package.json/lockfile/CI,与宿主互不引用;宿主 tsconfig 已排除本目录)。
未来需要独立仓库时用 `git subtree split` 拆出,历史可保留。

## D2 开发登录先行,Casdoor 后置(2026-08-26)
M0 验收只需要本地登录。已实现 `AUTH_DEV_LOGIN=true` 下的 `POST /api/auth/dev-login`
(iron-session HttpOnly Cookie,会话结构 `{ sub, name, role }` 与未来 Casdoor 对齐);
Casdoor OIDC(授权码 + PKCE)按 SPEC 计划在教师端里程碑前接入,届时仅替换登录入口,
会话与鉴权代码不变。

## D3 PWA 先 manifest,Serwist 后置(2026-08-26)
M0 验收清单要求的是 PWA manifest(已实现 `app/manifest.ts` + 图标)。Serwist 的
Service Worker(应用壳预缓存/试卷 JSON 运行时缓存)对离线作答真正有价值的时点是 M2
(本地保存 + 同步队列)——届时一并接入,避免 M0 就引入 SW 调试面。

## D4 本地验证用系统 PostgreSQL 16(2026-08-26)
实施沙箱无 docker daemon,但系统装有 PostgreSQL 16。M1 的迁移/种子/幂等验证在本地
真 PG16(initdb 临时集群,端口 55432)上执行,与 SPEC 要求的目标数据库同版本;
docker-compose.yml 照常提供给有 docker 的环境。CI 用 postgres:16 服务容器。

## D5 Zustand/Dexie 等前端依赖按需引入(2026-08-26)
M0 只安装当下会被 import 的依赖;Zustand + Dexie(离线作答)在 M2、Serwist 在 M2、
openai/mammoth/turndown 在 M4/M5 引入,避免脚手架期的幽灵依赖。

## D6 seed 断言仅对样本卷生效(2026-08-26)
`pnpm seed` 的 1-6-8-43-100 断言只在导入 `hubei-zsb-english-2025` 时执行,
其它试卷走同一导入路径但不套用该卷的常量。

## D7 M2 首页练习入口先列全部试卷(2026-08-27)
种子卷状态为 draft(主观题答案待教师核定),发布流转(draft→published)在 M5 教师端
落地。M2 首页对已登录用户列出全部试卷以打通练习链路;M5 上线后收紧为学生仅见
published、教师可见全部。`POST /api/attempts` 同步收紧。

## D8 M2 端到端验证用本地 dev server + 移动视口浏览器冒烟(2026-08-27)
正式 Playwright e2e 入 CI 仍待 M3(需要可复位的测试数据库);M2 以本地 dev server +
390×844 视口真浏览器手工冒烟覆盖:登录→开卷→填空→对答案→反馈卡→答题卡跳转→
刷新恢复,并在 PROGRESS 写明真机(微信)验收步骤。

## D9 自由模考可重复,任务考试的不可重做延后到任务链路(2026-08-27)
SPEC §6「考试默认不可重做」针对教师发布的任务考试;学生自发的模考(paperId + mode
=exam,无 assignmentId)不受限——已交的不挡新开,未交的续答同一 attempt(倒计时
不重置,即断线续答)。assignment 考试的不可重做与教师授权二次作答在 M5/M6 任务链路强制。

## D10 逾期自动交卷 = instrumentation 定时清扫 + 请求惰性兜底(2026-08-27)
§9.5 的「工作线程」在 Next.js standalone 部署下用 src/instrumentation.ts 实现:
服务启动后每 60 秒 sweepOverdueExams(截止 + 60 秒宽限已过的 in_progress 考试逐个
submitAttempt(auto));GET attempt / result 命中逾期时也惰性交卷,双保险。M4 引入
ai_jobs 工作线程后可并入同一循环。

## D11 e2e 入 CI:chromium 引擎跑双移动视口,串行执行(2026-08-27)
CI 只安装 chromium:iPhone 13 描述符默认 WebKit,两个 project 显式覆盖
browserName='chromium'(视口/UA/触摸仿真保留,引擎差异靠微信真机验收覆盖)。
workers=1 串行:模考流程同一开发账号会续答同一 attempt,并行会互抢考试。
e2e 步骤对 next start 的真服务执行,库就是同 job 已种子的 postgres:16 容器。

## D12 AI 调用不引 SDK,fetch 直连 OpenAI 兼容接口(2026-09-13)
M4 的评分/解析只需 chat/completions 一个端点:温度 0、response_format=json_object、30 秒超时、
用 AbortController 中止。直接 fetch 比引 openai 包少一层依赖与版本耦合,也便于在测试里注入
假调用器(AiCaller)对真库跑集成用例而不打真接口。错误按 kind 分类(timeout/network/http/
bad_response/not_configured):超时、网络、429/5xx 视为瞬时可重试;其余不重试直接分流待评。

## D13 成本日志记在 ai_jobs.result.usage + 控制台一行(2026-09-13)
不另建 ai_usage 表:每条任务的 promptTokens/completionTokens/latencyMs/model 存进
ai_jobs.result,同时 console.log 一行「[ai] grade job=… item=题号 tokens=p+c ms=…」——只记题号
与用量,不记学生内容(§9.5 个人信息最小化)。单价随模型而异,汇总换算在 M5 教师端做。

## D14 ai_jobs 工作线程并入 instrumentation,与逾期清扫同进程(2026-09-13)
SPEC §9.1「应用内轮询工作线程(间隔 2 秒,单进程)」:register() 里每 2 秒 processAiJobs
(每轮最多 5 条,同进程 busy 标志防重入),领取用 FOR UPDATE SKIP LOCKED,多实例也安全;
失败后按 attempts×5 秒退避重试,最多 3 次。AI 未配置时线程照常跑,把任务立即分流为
「待老师评」,学生端不会无限等待。逾期清扫(D10)保留 60 秒节拍。

## D15 提示词以 prompts/*.md 存放,standalone 产物显式带上(2026-09-13)
按 §5.3「提示词以文件形式存放,教师可改不动代码」:系统提示词 5 份在 prompts/,运行时
fs 读取并缓存;PROMPT_VERSION 参与缓存哈希,改提示词后旧缓存自然失效(需手动升版本)。
next.config 用 outputFileTracingIncludes 把 prompts/** 带进 standalone 产物;M7 的 Dockerfile
不必再单独 COPY。

## D16 练习模式 AI 反馈用轮询而非推送(2026-09-13)
§7.5 规定每 3 秒、最长 90 秒轮询:新增 GET /api/attempts/:id/feedback?itemIds= 只回已落库的
判分结果(考试模式 403);超时后反馈卡显示「稍后在成绩页查看」。不引 WebSocket/SSE,
微信内置浏览器与弱网下更稳。

## D17 送评答案快照进任务,写回前核对,悬挂任务超时回收(2026-09-13,评审后)
练习模式作答可随时改,入队与执行之间有窗口:任务 payload 保存入队时的答案快照与哈希,
工作线程只评快照,缓存按快照哈希写;写回 responses 前核对当前答案仍等于快照且非教师终评,
否则作废(job.result.applied=false,记 superseded),由下一次「对答案」重新入队。running
超过 5 分钟(> AI 超时)按进程崩溃遗留回收重跑;未预期异常把任务放回 queued 而非留在 running。

## D18 限速与防注入放在应用层,不引入网关(2026-09-13,评审后)
§9.5 的按用户限速用进程内滑动窗口(check 60 次/分钟、explain 30 次/分钟),单进程部署足够,
多实例各自计数即可。提示词注入防线两道:学生答案用 <student_answer> 标签包裹并在系统提示词
声明标签内指令无效;服务端启发式(对阅卷者的指令、分数/置信度赋值、JSON 片段)命中即强制
教师复核且结果不入缓存——宁可多送复核,不让注入拿满分。

## D19 汉译英兜底二值化;作文字数用封顶而非减法(2026-09-13,评审后)
§5.2 规定兜底只判「是否可接受」:提示词只允许满分或 0,服务端再 foldBinary 折成二值,去掉
partial。作文 minWords 不足:提示词让模型把字数维度记 0,服务端用「总分 ≤ 满分 − 字数维度」
封顶——模型已扣的不再扣、没扣的强制扣,不会双重扣分。
