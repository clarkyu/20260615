# Claude-Video `/watch`（开发期工具）

让 Claude 在 Claude Code 里「看视频」的插件:`/watch <URL或本地路径> <问题>` →
`yt-dlp` 下载 → `ffmpeg` 抽帧 → 原生字幕或 Whisper 转写 → 帧图 + 带时间戳字幕交给 Claude 回答。

来源:[bradautomates/claude-video](https://github.com/bradautomates/claude-video)。**纯开发期工具**,
不进 Next/OpenNext 构建产物、不进 PWA 运行时,对生产 / D1 / Workers **零影响**。

## 本机启用（配置已在仓库 `.claude/settings.json` 里声明，team-wide）

1. `git pull`（拿到 `.claude/settings.json` 里的市场登记 + 启用声明）。
2. 在 Claude Code 里打开本项目 → 提示「watch 已启用但未安装」→ 跑
   `/plugin install watch@claude-video` 确认安装（**提交配置不会自动执行任何脚本**,
   脚本只在你显式调用 `/watch` 时才跑）。
3. 本机需有 `ffmpeg` 和 `yt-dlp`（首次 `/watch` 会自检;macOS 经 `brew` 自动装,
   Linux/Windows 会打印安装命令）。
4. 转写可选走 Groq(`GROQ_API_KEY`) / OpenAI(`OPENAI_API_KEY`) Whisper —— 缺 key
   则只用视频原生字幕。密钥存 `~/.config/watch/.env`。

## ⚠️ 数据流向（面向 minors，务必注意）

无原生字幕时,转写会把**音频发往 Groq/OpenAI** 第三方服务。**不要拿 `/watch` 处理学生录音
或任何 PII 视频**,只对公开 / 非敏感视频使用。

另一条要知道的:`whisper.py` 找 key 时除了 `~/.config/watch/.env` 和环境变量,还会**静默读
当前目录的 `.env`**。别在放了 `OPENAI_API_KEY`/`GROQ_API_KEY` 的项目目录里跑 `/watch`
（本仓库无 `.env`、`.dev.vars` 也不含这两个键,当前安全）;Whisper key 只放
`~/.config/watch/.env`（600 权限）。

## 省 token 用法（开发环境默认已调好）

token 大头是**帧图**（512px 宽一帧 16:9 约 ≈200 token;竖屏更高）。字幕/转写文本很便宜,
而**原生字幕完全免费**（yt-dlp 直接拉,不下载视频、不调 Whisper）。因此原则:
**能用字幕答的绝不抽帧;要抽帧就抽最少的**。

### 档位（`WATCH_DETAIL` / `--detail`）

| 档 | 帧上限 | 什么时候用 |
|---|---|---|
| `transcript` | **0 帧**(不加 `--timestamps` 时) | 「说了什么」类问题:讲座/播客/教程。**首选** |
| `efficient` | ≤50(关键帧) | 「大概看看画面」;**本项目默认档** |
| `balanced` | ≤100(场景感知) | 插件出厂默认;画面细节较重时手动升 |
| `token-burner` | 不封顶(>250 帧仅软警告) | 逐帧对细节,明确需要才用 |

另有按时长的**采样预算**(≤30s 约 12–30 帧、1–3min 约 60、3–10min 约 80)——注意它只约束
均匀采样路径的 fps;场景/关键帧引擎只受档位上限约束,剪辑密的视频在 balanced 下可以顶到 100 帧。
**字幕只拉英文**(`--sub-langs en.*`):纯中文字幕的视频拿不到免费字幕,会退到「仅帧」
(无 key 时)或 Whisper(有 key 时)——中文内容想省钱,提问尽量走帧能答的问题。

### 项目里已固化的三层省 token 设置

1. **`.claude/settings.json` 里 `env.WATCH_DETAIL=efficient`** —— 本项目的所有 Claude Code
   会话默认走 efficient(环境变量优先级高于个人 `~/.config/watch/.env`);要更高档在单次
   调用里 `--detail balanced` 显式升。
2. **不配 Whisper key = 零转写费** —— 有(英文)字幕的视频照常全功能;无字幕的出帧不出转写
   (需要转写再临时配 key,优先 Groq,更便宜)。无 key 同时意味着**音频物理上不可能外发**
   ——「无 key」指环境变量、`~/.config/watch/.env`、**和当前目录 `.env`** 三处都没有
   (见上节 cwd `.env` 注意)。
3. **`~/.config/watch/.env` 写 `SETUP_COMPLETE=true`** —— SessionStart hook 从此零输出
   (前提:ffmpeg/yt-dlp 在位、该文件 600 权限,下面的配置即满足),不在每个会话开头往
   上下文里塞安装提示(否则每个会话都白烧一点 token 还会诱导模型跑 setup)。
   推荐的本机配置(沙箱里已按此配好):

   ```bash
   mkdir -p ~/.config/watch && cat > ~/.config/watch/.env <<'EOF'
   WATCH_DETAIL=efficient
   SETUP_COMPLETE=true
   EOF
   chmod 600 ~/.config/watch/.env
   ```

### 单次调用的省 token 阶梯（由便宜到贵）

1. `\/watch <url> --detail transcript <问题>` —— 纯字幕,几乎零图像 token;
2. 不够再 `--start/--end` 或 `--timestamps` **只抽相关片段/时刻**的帧;
3. 还不够才整段 `efficient` → `balanced`;长视频(>10min)先问清楚要看哪一段,别整片扫。

## 供应链版本固定

`.claude/settings.json` 里市场源**锁到具体 commit `sha`**（不是浮动的 `main` 分支),
上游静默改动不会被下次 `/plugin install` 拉进来。想升级到上游新版:

1. `git ls-remote https://github.com/bradautomates/claude-video refs/heads/main` 取最新 SHA;
2. 审一遍上游 diff（这是第三方会跑 `ffmpeg`/下载/外发音频的脚本,值得看一眼）;
3. 把 `extraKnownMarketplaces.claude-video.source.sha` 换成新 SHA,走一条 PR。
