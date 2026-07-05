# 英语背诵作业 App

手机端英语背诵作业平台：老师导入名单、发布 50 句背诵作业；学生**闭眼背诵 + 前置摄像头录制**并提交；**AI 按评分标准评阅打分**；老师人工复核、按班级导出 Excel 成绩。PWA 手机优先，**部署在 Cloudflare（Workers + D1 + R2）**，面向大陆用户。

## 技术栈（Cloudflare 原生）

- Next.js 15（App Router）+ React 19，**PWA 手机优先**
- 运行时：**Cloudflare Workers**，经 `@opennextjs/cloudflare`（OpenNext）适配
- 数据库：**Cloudflare D1**（SQLite）+ Prisma 7 `@prisma/adapter-d1`
- 会话：iron-session（WebCrypto）；**口令：WebCrypto PBKDF2**（Workers 上 bcrypt 不可行）
- 邮件：**Resend** HTTP API；对象存储：**R2**（aws4fetch 预签名直传）
- 可插拔 **AI 评阅层**：两段式（① 感知 → ② 评分）+ 模型注册表
- Tailwind + shadcn 风格组件；Vitest

## 角色与登录

- **老师 / 管理员**：邮箱注册 + 邮件验证登录（`ADMIN_EMAIL` 首注册为超管）
- **学生**：名单制，**学校代码 + 学号**登录，初始密码 = 学号，首登强制改密

## 主要流程

- **老师**：建校 → Excel 名单导入（预览 → 幂等）→ 发布作业（50 句/班级/时间窗/闭眼）→ 阅卷看板（选模型 + 阅卷时填评分标准 + AI 评阅 + 人工改分 + 看视频）→ 按班级导出 Excel
- **学生**：看作业 → 复习 → 全屏录制（前置、切屏/离开记违规）→ 预签名直传 R2 → 提交 → 看成绩

## AI 评阅 + 出题层（`src/lib/ai/`）

- `registry.ts`：模型注册表（Gemini/Qwen/MiniMax/GPT-4o/Whisper/DeepSeek/Claude）+ 能力（感知/评分/出题）/模态标签 + 预设
- `grade.ts`：两段式编排（感知→评分）；`adapters.ts`：各家真实适配器（缺 key 优雅降级）。感知 / 评分 / 备课出题三阶段都按 provider **可插拔**（`getPerceptionProvider` / `getJudgeProvider` / `getAuthorProvider`）
- 默认「能让 DeepSeek 做的都交给 DeepSeek」：**评分**默认 DeepSeek V4 Pro（推理版，纯文本），**文字出题**默认 DeepSeek V4 Flash；DeepSeek 做不了的多模态活儿——**感知**（视频/音频）与**拍课本照片出题**——走 Gemini。老师可按作业/环节自选模型。专用发音引擎为二期

## 本地开发

```bash
npm install
npm run cf:typegen            # 生成 Cloudflare 绑定类型（可选）
npm run d1:migrate:local      # 在本地 D1 应用迁移（d1/migrations）
npm run dev                   # http://localhost:3000（OpenNext 注入本地绑定）
```

本地 secrets 放 `.dev.vars`（见 `.env.example` 的变量名）。绑定（D1 `DB` / R2 `BUCKET`）在 `wrangler.jsonc`。

## 校验

```bash
npm test && npx tsc --noEmit && npm run lint && npm run cf:build
```

`cf:build` 产出 `.open-next/worker.js`（Workers 包）。`npm run cf:preview` 可本地以 workerd 预览。

## 部署到 Cloudflare

> 📖 完整的运维/部署手册（环境变量全表、迁移与回滚、定时任务、密钥轮换、故障排查、
> 灾备、部署后健康检查）见 **[`docs/OPERATIONS.md`](docs/OPERATIONS.md)**。下面是速览。

```bash
# 一次性：建资源
npx wrangler d1 create recitation-db      # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create hihomework
# secrets（逐个）
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put R2_ENDPOINT       # 及 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / APP_URL / ADMIN_EMAIL / EMAIL_FROM / AI keys

# 迁移 + 部署
npm run d1:migrate            # 远程 D1 应用 d1/migrations
npm run cf:deploy            # opennextjs-cloudflare deploy
```

> ⚠️ **需要 Workers Paid（约 $5/月）**：Queues / Durable Objects / 更高 CPU 时长 / D1 超免费额度。
> ⚠️ Cloudflare 大陆无节点（无 ICP），国内用户走海外 PoP，体验与香港机相当。

## 迁移进度（Path B：Cloudflare 原生）

- ✅ Phase 0：OpenNext + Wrangler 工具链；`cf:build` 产出 Workers 包
- ✅ Phase 1（核心）：DB→D1（Prisma adapter，请求级 `getDb()`）；交互式事务改 D1 batch
- ✅ Phase 2：tokens/口令→WebCrypto(PBKDF2)；邮件→Resend；预签名→aws4fetch
- ✅ Phase 3：接真实 AI（Gemini / Qwen / MiniMax / DeepSeek / GPT-4o / Whisper / Claude **均已实接**，缺 key 优雅降级）；Excel 导入/导出走 SheetJS；CI（构建+测试）与「合并 main 自动迁移+部署」（见 `.github/workflows/ci.yml`、`deploy.yml`）
- ✅ Phase 4：真实 PWA 图标、隐私同意告知、视频留存定期清理、后台评阅定时排空（安全 drain）均已落地；媒体清理覆盖提交/跟读/练一练/题库视频（详见 `docs/BACKLOG.md`）
- ⏭️ 待办：wrangler dev + 本地 D1 端到端实测。**限流 Durable Object / 原生 Cloudflare Queues 经评估有意不做**——限流已是 D1 共享存储（跨 isolate 一致），评阅定时排空已用安全方案替代；二者均需不可本地验证的 OpenNext Worker 入口改造，性价比不足（详见 `docs/BACKLOG.md` P4）
