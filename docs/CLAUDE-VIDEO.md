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

## 供应链版本固定

`.claude/settings.json` 里市场源**锁到具体 commit `sha`**（不是浮动的 `main` 分支),
上游静默改动不会被下次 `/plugin install` 拉进来。想升级到上游新版:

1. `git ls-remote https://github.com/bradautomates/claude-video refs/heads/main` 取最新 SHA;
2. 审一遍上游 diff（这是第三方会跑 `ffmpeg`/下载/外发音频的脚本,值得看一眼）;
3. 把 `extraKnownMarketplaces.claude-video.source.sha` 换成新 SHA,走一条 PR。
