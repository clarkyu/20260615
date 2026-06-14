# 英语背诵作业 App

手机端英语背诵作业平台：老师导入名单、发布 50 句背诵作业；学生**闭眼背诵 + 前置摄像头录制**并提交；**AI 按评分标准评阅打分**；老师人工复核、按班级导出 Excel 成绩。PWA 手机优先，部署在海外、面向大陆用户。

> 在 ScoreProphet 自托管技术栈（Next.js 15 + Prisma/SQLite + iron-session + Docker）之上构建。

## 技术栈

- Next.js 15（App Router, `standalone`）+ React 19，**PWA 手机优先**
- Prisma 7 + SQLite（`better-sqlite3`）
- iron-session 角色会话；bcrypt 口令；nodemailer 邮件
- **Cloudflare R2** 存学生视频（手机经预签名 URL 直传，最大单次 PUT 5GB）
- **可插拔 AI 评阅层**：两段式（① 感知 → ② 评分）+ 模型注册表
- Tailwind + shadcn 风格组件；Vitest；多阶段 Docker

## 角色与登录

- **老师 / 管理员**：邮箱注册 + 邮件验证登录；首个 `ADMIN_EMAIL` 注册者为超管。
- **学生**：名单制，用**学校代码 + 学号**登录，初始密码 = 学号，首次登录强制改密。

## 老师流程

1. 创建学校（拿到「学校代码」发给学生）
2. **Excel 导入名单**（学号/姓名/班级 + 可选 院系/专业）：先预览校验，再确认导入，按学号幂等
3. 发布作业（50 句、分配班级、开放/截止时间、可提交次数、是否闭眼）
4. **评阅**：选模型预设（或高级分别选 ①感知/②评分）+ 填评分标准 → AI 出分 + 评语
5. 人工**改分**（AI 为参考，老师为准）
6. **按班级导出 Excel** 成绩

## 学生流程

看作业 → 复习句子 → 全屏录制（前置摄像头、一镜到底、监测切屏/离开记违规）→ 直传 R2 → 提交 → 查看成绩。

## AI 评阅层（可插拔）

`src/lib/ai/`：

- `registry.ts`：模型注册表（Gemini / Qwen / MiniMax / GPT-4o / Whisper / DeepSeek / Claude）+ 能力/模态标签 + 预设
- `grade.ts`：两段式编排——① 感知（视频/音频 → 转写+发音印象+作弊观察）→ ② 评分（按评分标准出分+评语）
- `adapters.ts`：各家适配器（**当前为占位桩**，整条流程已跑通，接入真实 API key 后即可替换）

> DeepSeek 仅能做 ② 评分（纯文本）。Gemini 原生吃视频+音频，最适合一把梭。专用发音引擎（讯飞/Azure）为二期增强。

## 本地开发

```bash
npm install
DATABASE_URL="file:./dev.db" npx prisma migrate dev
npm run dev   # http://localhost:3000
```

`.env` 见 `.env.example`。未配 R2 时录制可用但上传会提示「存储未配置」；未配 SMTP 时老师注册会提示发信失败（本地可用 Mailpit）。

## 校验

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

## 部署（海外 / 无备案，面向大陆用户）

```bash
cp .env.example .env   # 填好后
docker compose up -d --build
```

- 应用 + SQLite 自托管在**香港/海外**单机（数据在 `app_data` 卷的 `/data/app.db`，启动自动迁移）。
- 学生手机**只跟香港源站说话**；视频走**手机直传 R2**（经 Cloudflare 海外 PoP）。
- AI 评阅在**服务端**调用，国内可达性不影响学生。
- 无备案站点有被限速/封锁的固有风险，全程 HTTPS。

## 已知待办（下一阶段）

- AI 适配器接入真实 API（先 Gemini 一把梭）；专用发音引擎（原版录音对比）
- 录制断点续传（弱网）；iOS Safari 录制实测；服务端抽音频+抽帧降本
- 真实 PWA 图标（当前为占位 SVG）；隐私同意与视频留存策略
- 防作弊：PWA 只能「检测+标记」，硬性锁死需原生 App
