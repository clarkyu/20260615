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
