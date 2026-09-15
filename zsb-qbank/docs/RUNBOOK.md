# RUNBOOK · zsb-qbank 上线与运维

面向部署这套题库的人(clark)。一台装了 Docker 与现成反向代理的机器即可。
设计依据见 `docs/SPEC.md` §9.6;里程碑自检见 `docs/PROGRESS.md`。

---

## 一、首次上线

### 1. 准备

```bash
git clone <仓库> /srv/zsb && cd /srv/zsb/zsb-qbank
cp .env.example .env
```

`.env` 至少要改这几项:

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_PASSWORD` | 数据库密码,随机串 |
| `DATABASE_URL` | 宿主机上跑迁移 / 备份用:`postgres://zsb:<密码>@127.0.0.1:5432/zsb_qbank`(容器内部由 compose 自动注入 `db:5432`) |
| `SESSION_SECRET` | `openssl rand -base64 32`,≥32 字符;换掉它 = 所有人被登出 |
| `APP_ORIGIN` | 对外地址,如 `https://zsb.example.com`。写接口按它校验 Origin(§9.5) |
| `AUTH_DEV_LOGIN` | 生产必须 `false`(为 `true` 时任何人都能一键登录成教师) |
| `CASDOOR_ISSUER` / `CASDOOR_CLIENT_ID` / `CASDOOR_CLIENT_SECRET` | 统一身份登录;三项齐全即启用,见下「统一身份登录」 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL_GRADING` | AI 评分;三项任一缺失即视为未配置,主观题会分流为「待老师评」,系统不崩溃 |
| `AI_MODEL_AUTHORING` | 解析、导入结构化、变式题用的模型;留空则用 `AI_MODEL_GRADING` |

密钥只放 `.env`(已在 .gitignore),不要提交,不要写进日志。

### 2. 起服务

```bash
docker compose up -d --build          # db + app
docker compose ps                     # app 应为 healthy
curl -s localhost:3000/api/health     # {"ok":true,...}
```

`app` 只监听 `127.0.0.1:3000`,不直接对外。

### 3. 迁移与种子

```bash
docker compose run --rm tools pnpm db:migrate     # 建表 / 加列,幂等
docker compose run --rm tools pnpm seed           # 导入 2025 真题种子,幂等
```

`tools` 是一次性运维容器(带 devDependencies 的构建层镜像),不随 `up` 常驻;
运行镜像是精简的 standalone 产物,里面没有 `tsx`,所以迁移与种子走 `tools`。

种子会导入 2025 年真题(1 卷 / 6 大题 / 8 题组 / 43 小题 / 总分 100,状态为「已发布」)。
以后导入新卷走教师端「导入 Word 试卷」,新卷默认是草稿,教师在试卷页点「发布」后学生才看得到。

### 4. 反向代理与 HTTPS(硬性要求)

Service Worker 与 `Secure` Cookie 都依赖 HTTPS。Caddy 示例:

```
zsb.example.com {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3000
}
```

nginx 示例(已有证书时):

```nginx
server {
    listen 443 ssl http2;
    server_name zsb.example.com;
    ssl_certificate     /etc/letsencrypt/live/zsb.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zsb.example.com/privkey.pem;
    client_max_body_size 12m;              # docx 上传上限 8 MB,留余量

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;      # 写接口的 Origin 校验要用
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_read_timeout 65s;                        # AI 调用最长 30 秒
    }
}
server {
    listen 80;
    server_name zsb.example.com;
    return 301 https://$host$request_uri;
}
```

上线后自测:`curl -I https://zsb.example.com/` 应有 `cache-control: no-cache`(微信缓存激进,HTML 不缓存)。

### 5. 统一身份登录(Casdoor)

在 Casdoor 里建一个应用,然后把三项配置填进 `.env`:

1. Casdoor → 应用 → 添加:
   - **Redirect URLs** 填 `https://zsb.example.com/api/auth/callback`(与 `CASDOOR_REDIRECT_URI` 或
     `APP_ORIGIN` 推出的地址必须完全一致)
   - **Grant types** 勾 `authorization_code`;**Token format** 选 JWT;scope 至少含 `openid profile`
2. `.env` 填 `CASDOOR_ISSUER`(Casdoor 根地址)、`CASDOOR_CLIENT_ID`、`CASDOOR_CLIENT_SECRET`,
   并确认 `APP_ORIGIN` 是对外地址。
3. 角色:默认把组 / 角色名里含 `teacher`、`教师` 的判为教师,`admin`、`管理员` 判为管理员,其余是学生;
   用 `CASDOOR_TEACHER_GROUPS` / `CASDOOR_ADMIN_GROUPS` 可改(逗号分隔,大小写不敏感)。
   给老师在 Casdoor 里加上对应的组即可,系统这边不需要再建账号。
4. `docker compose up -d` 重启后,首页与 `/teacher/login` 会出现「统一身份登录」按钮;
   三项里缺任何一项,按钮不出现,回落到开发登录。

登录流程是授权码 + PKCE:`/api/auth/login` 生成 state / nonce / code_verifier 存进加密会话并跳转,
`/api/auth/callback` 核对 state、用授权码换 token、校验 `id_token` 的 iss / aud / exp / nonce,
再按组映射角色建会话。系统只存 sub、姓名、角色(§9.5 个人信息最小化),不存手机号与邮箱。

排查:登录失败会回到 `/teacher/login` 并在页面上显示中文原因(如「audience 不匹配」= client id 填错、
「nonce 不匹配」= 会话过期重新点一次);服务端日志只记 `[auth] casdoor 登录成功 role=…`,不记姓名与 sub。

### 6. 建账号与开课

1. 教师端 `https://zsb.example.com/teacher` 登录(统一身份登录;没配 Casdoor 时用开发登录)。
2. 「班级」建班 → 拿六位加入码 → 发到微信群。
3. 「试卷」确认目标卷是「已发布」;或「导入」上传 Word 真题 → 校对 → 保存 → 发布。
4. 「任务」选试卷(整卷或勾选小题)、班级、模式、开放与截止时间 → 发布。
5. 学生手机打开首页 → 输入加入码 → 「我的任务」出现 → 作答。

---

## 二、日常运维

### 备份与恢复

```bash
# 手动备份(默认 ./backups,保留 14 天)
./scripts/backup.sh

# cron:每天 03:10
10 3 * * * cd /srv/zsb/zsb-qbank && ./scripts/backup.sh >> /var/log/zsb-backup.log 2>&1

# 恢复演练(务必恢复到另一个库,别直接盖生产)
createdb -h 127.0.0.1 -U zsb zsb_restore_test
./scripts/restore.sh backups/zsb-20260914-031000.dump postgres://zsb:<密码>@127.0.0.1:5432/zsb_restore_test
```

`restore.sh` 结束会打印 papers / items / attempts / responses 四张表的行数,对得上就算恢复成功。
**每季度做一次恢复演练**:没验证过的备份等于没有备份。

### 升级

```bash
cd /srv/zsb && git pull
cd zsb-qbank
docker compose up -d --build
docker compose run --rm tools pnpm db:migrate                      # 有新迁移时
docker compose logs -f app | head -50                              # 看启动日志
```

回滚:`git checkout <上一个 tag/commit> && docker compose up -d --build`。
迁移只向前加列 / 加表,回滚代码一般不用回滚数据库;真要回滚数据,用当天备份。

### 看日志与队列

```bash
docker compose logs -f app                       # 全部
docker compose logs app | grep '\[ai\]'          # AI 评分 / 解析 / 变式:任务与 token 用量
docker compose logs app | grep '\[sweep\]'       # 逾期考试自动交卷
```

AI 队列是进程内轮询线程(每 2 秒一轮),重启 app 即可重新消费未完成任务;
卡住的任务超过 5 分钟会自动回收重跑,失败 3 次后分流为「待老师评」,老师能在「批改」里处理。

### 常见问题

| 现象 | 处理 |
| --- | --- |
| 学生说「试卷加载不出来」 | `curl -s localhost:3000/api/health`;看 `docker compose ps` 里 db 是否 healthy |
| 主观题一直「待老师评」 | AI 未配置或密钥失效:`docker compose logs app \| grep ai_not_configured`;改 `.env` 后 `docker compose up -d` |
| 交卷后分数没变 | AI 判完由工作线程写回,刷新成绩页;仍不对就在「批改」里手动改分(教师分是终评) |
| 老师说学生看不到试卷 | 试卷状态是不是「草稿」;任务是不是还没到开放时间 |
| 上传 docx 报「文档内容过大」 | 解压后超过 64 MB(多半是图片多),拆分文档或删图后再传 |
| 429「操作太频繁」 | 写接口每人每分钟 120 次上限;正常使用不会触发,脚本刷会 |

---

## 三、真机验收矩阵(§7.7)

每次大版本上线后,在四台真机上各走一遍。全部通过才算上线完成。

| 设备 | 浏览器 |
| --- | --- |
| iPhone | 微信内置浏览器 |
| iPhone | Safari |
| Android | 微信内置浏览器 |
| Android | Chrome |

每台机器依次验:

1. **壳与布局**:打开首页,单列、无横向滚动、按钮能一次点中(≥44 px);旋转横屏不错位。
2. **加入班级**:输入六位加入码 → 「我的任务」出现任务卡。
3. **练习**:开始练习 → 填词用底部作答条,键盘弹出时作答条贴在键盘上沿 → 「对答案」出现反馈卡(对错、参考答案、解析)→ 「完成」后能看成绩。
4. **考试**:开始考试 → 顶部倒计时在走 → **把 App 切到后台 2 分钟再回来,倒计时应按服务端时间跳到正确值**(不是接着旧值走)→ 交卷 → 成绩页在老师发布前不显示参考答案。
5. **断网续答**:飞行模式下继续答题(答案先落本地)→ 恢复网络 → 顶部同步状态变「已同步」→ 刷新页面答案还在。
6. **断网打开(Service Worker)**:在作答页停留几秒(壳与试卷会被缓存)→ 开飞行模式 →
   **刷新作答页,页面仍打得开、之前的作答还在** → 再打开首页,应看到「现在连不上网」那一页
   (**不是**带着姓名和任务的旧首页——首页不缓存是有意的:手机可能是共用的)→ 关飞行模式,
   刷新恢复正常。
   > 这一条只能真机验:Chromium 的离线仿真对 SW 转发的导航请求不稳定,自动化里写了会时好时坏
   > (`tests/e2e/offline.spec.ts` 因此只断言「缓存里有什么」与「登出会清缓存」)。
   > iOS 微信内置浏览器可能不支持 Service Worker,那台机器上这条不通过是预期的,记一句即可;
   > 断网续答(第 5 条)不依赖 SW,仍必须通过。
7. **训练**:首页「每日训练」→ 今日任务 → 答错一题 → 反馈卡提示「1 天后再复习一次」。
8. **输入法**:英文输入框不自动大写、不自动纠错、不弹拼写建议;字号不小于 16 px(聚焦时页面不放大)。
9. **下拉刷新**:考试页下拉不触发浏览器刷新。
10. **性能**:4G 下首页 LCP 主观上「两三秒内出内容」;`pnpm budget` 在 CI 里已保证首屏 JS ≤ 200 KB(gzip)。

记录结果到本文件末尾的「验收记录」表。

---

## 四、已知限制

- **登录**:Casdoor OIDC 已接入(授权码 + PKCE,见上「统一身份登录」)。没配 Casdoor 时才回落到
  `AUTH_DEV_LOGIN` 开发登录——生产上两者必须二选一,别让开发登录留在打开状态。
  id_token 不验签:它是服务端用 client_secret 直接从 token 端点(TLS)换来的,不经浏览器
  (OIDC Core 3.1.3.7 允许);声明仍逐条校验。
- **Service Worker / 离线壳**:已接入(Serwist,源码 `src/app/sw.ts`,策略 `src/lib/offline/cache-policy.ts`)。
  缓存范围是刻意保守的:只有构建产物、断网兜底页、作答页 / 成绩页的壳、以及**进行中的那份作答**;
  首页 / 训练页 / 教师端带着姓名与任务,一律不缓存,断网打开它们会看到「现在连不上网」。
  登录 / 登出(任何 `/api/auth/*`)会清掉那份带个人数据的缓存 —— 共用手机换个人用,读不到上一个人的卷子。
  首次打开仍需要网络;iOS 微信内置浏览器可能不支持 SW,那里退回「有网才能打开、断网仍能续答」。
- **每题中位用时**:已采集。口径是「停留在这道题上的时间」(切到该题开始计、切走 / 切后台 / 交卷结束),
  单段超过 3 分钟按 3 分钟计、单题封顶 30 分钟。埋点是尽力而为的:旧作答与埋点丢失的显示「—」,
  学情页括号里标样本数。训练模式(`/train`)还没接埋点。
- **单机部署**:AI 队列与逾期清扫是进程内线程,多副本部署会重复消费(领取用
  `FOR UPDATE SKIP LOCKED`,安全但无意义);要横向扩容时先把线程拆成单独进程。

---

## 五、验收记录

| 日期 | 版本 | 设备 / 浏览器 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| | | iPhone 微信 | | |
| | | iPhone Safari | | |
| | | Android 微信 | | |
| | | Android Chrome | | |
