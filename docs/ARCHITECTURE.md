# 架构分层约定 / Architecture & Layering

「你好！作业」是一个 Cloudflare（Workers + D1 + R2）上的 Next.js App Router 应用。
服务端代码遵循固定的分层，新增功能请照此放置。

## 分层（自上而下）

```
 app/**            页面（Server Component）— 渲染 + 只读聚合查询
 actions/**        Server Action — 鉴权 → 校验 → 委派 → revalidate/redirect（薄）
 lib/domain/**     领域服务 — 业务编排 + 策略（无 auth / i18n / Next 请求管线）
 lib/repo/**       仓储 — 数据访问 + 多租户作用域（唯一直接碰 prisma 的常规位置）
 lib/**            基础设施 — db / session / storage / ai / config / validate …
```

依赖方向只能自上而下：action 调 domain/repo，domain 调 repo，repo 调 prisma。

## 各层职责

### `actions/**`（薄 action）
- 用 `@/lib/action-context` 的 `staffContext` / `staffSchoolContext` / `studentContext`
  拿到 `{ user, prisma, t }`（+ 严格的 `schoolId`），不再各自重复 `requireXxx + getDb + getT`。
- 用 `@/lib/validate` 的 `parseForm(schema, formData)` 校验输入；字段消息是 i18n key。
- 把业务逻辑委派给 `lib/domain`，或对单步 CRUD 直接调 `lib/repo`。
- **不直接写 prisma 查询**；`revalidatePath` / `redirect` 只在这一层。

### `lib/domain/**`（领域服务）
- 接收 `prisma` + 普通入参，返回数据/结果；错误用 i18n key 字符串，导航目标交回 action。
- 无 `requireXxx`、无 `getT`、无 `cookies()`/`redirect()`——便于单测与复用（如批改既被
  action 调用，也被异步任务队列调用）。
- 数据访问走 `lib/repo`。**例外**：批量 roster 导入（`domain/roster.ts`）是一个内聚的
  数据编排单元，直连 prisma——刻意保留，避免拆成十几个一次性 micro-repo。

### `lib/repo/**`（仓储）
- 每个聚合一个文件，函数签名形如 `(prisma, …args)`。
- **多租户作用域只此一处**：`where: { …, schoolId: schoolId ?? -1 }`（或经 `offering.schoolId`
  / `offering.classId`）。`?? -1` 哨兵确保「没有学校的用户」永远匹配不到别人的行。
- 不含 auth / i18n / Next。

### 边界（有意为之）
- **页面只读查询已全部收进仓储**：`app/**` 不再有内联 prisma；页面经 `getDb()` 取 client
  传给 `lib/repo` 的读函数（仪表盘等跨聚合的读放在 `repo/dashboard.ts` 读模型里）。
- **auth 流程（登录/注册/改密/验证邮箱）保持定制**：登录对「用户不存在」路径用恒定时间
  的假校验来防时序侧信道，刻意不走「先解析再早退」，以免泄露时序。

## 横切基础设施

- **配置**：`lib/config.ts` 是环境变量的唯一来源（`process.env` 由 OpenNext 注入），提供类型化
  getter、`storageConfigured()` / `aiConfigured()` 等能力开关，以及 `validateConfigOnce()`
  启动自检（在 root layout 调用，**只打印变量名 + 有无，绝不打印密钥值**）。
- **校验**：`lib/validate.ts`（zod）是 action 输入的唯一可信边界。
- **批改可靠性**：`lib/domain/jobs.ts` 持久任务表 `GradingJob` + 有界重试 + 自愈重扫。
- **后台工作**：`lib/cf.ts` 的 `runAfterResponse`（Worker `waitUntil`）。

## 安全约定

- 密钥只从环境变量读取，**绝不写入文件或提交**；日志只记「有/无」，不记值。
- 一切数据访问按学校/班级作用域；越权拦截集中在 `lib/repo`，可审计。
- 限流落 D1 共享表（跨 isolate 生效）；客户端 IP 取 `CF-Connecting-IP`（边缘设置、不可伪造）。
  D1 查询失败会记日志再退回内存版——静默退化等于把限流关掉，必须可见。

## 已知限制

- **`ClassGroup.majorId` / `User.departmentId` 在 D1 里没有真 FK**：这两列是用
  `ALTER TABLE ADD COLUMN` 加的，SQLite 无法借此加外键，所以 schema 里声明的
  `onDelete: SetNull` 不生效。后果**当前不可达**——应用里没有删除院系/专业的入口
  （`Department`/`Major` 只由名册导入创建，从不在应用内删除），故不存在产生悬挂引用的
  路径。要真正补 FK 需重建 `User`/`ClassGroup` 整张表，对线上数据是高风险、低收益的操作，
  故不做；**若将来新增删除院系/专业的功能，须在该操作里先把引用行的 `majorId`/
  `departmentId` 置空**（代码层兜底），或届时再评估重建表。
