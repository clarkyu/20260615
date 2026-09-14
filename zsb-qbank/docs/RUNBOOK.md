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

### 5. 建账号与开课

1. 教师端 `https://zsb.example.com/teacher` 登录(Casdoor 接入前先用开发登录,见「已知限制」)。
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
6. **训练**:首页「每日训练」→ 今日任务 → 答错一题 → 反馈卡提示「1 天后再复习一次」。
7. **输入法**:英文输入框不自动大写、不自动纠错、不弹拼写建议;字号不小于 16 px(聚焦时页面不放大)。
8. **下拉刷新**:考试页下拉不触发浏览器刷新。
9. **性能**:4G 下首页 LCP 主观上「两三秒内出内容」;`pnpm budget` 在 CI 里已保证首屏 JS ≤ 200 KB(gzip)。

记录结果到本文件末尾的「验收记录」表。

---

## 四、已知限制

- **登录**:Casdoor OIDC 尚未接入,目前靠 `AUTH_DEV_LOGIN` 开发登录(D2)。生产必须关掉它,
  等 Casdoor 接好再开放注册;在那之前可由 clark 用开发登录建好教师账号、学生用加入码进班。
- **Service Worker / 离线壳**:Serwist 尚未接入(D3),断网续答靠 IndexedDB + 同步队列,
  但首次打开仍需要网络。
- **每题中位用时**:未采集(无逐题计时埋点),学情页对应位置明示。
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
