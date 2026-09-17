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
mkdir -p backups && sudo chown 1001:1001 backups   # 备份目录,容器以 uid 1001 写它(见「备份与恢复」)
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

备份**跑在 app 容器里**,不在宿主机上 —— 本机只要求装了 Docker(见开头),不保证有
`pg_dump`,更不保证是 ≥ 16 的那版;而镜像里那份正好是 16,与 `postgres:16` 服务端对齐。
`./backups` 由 compose 挂进容器的 `/app/backups`,所以文件照样落在宿主机上。

**首次要先把目录交给容器用户**(容器以 uid 1001 运行;目录若由 docker 代建会是 root 所有,
写不进去,报 `Permission denied`):

```bash
mkdir -p backups && sudo chown 1001:1001 backups
```

```bash
# 手动备份(落到 ./backups,保留 14 天)
docker compose exec -T app ./scripts/backup.sh

# cron:每天 03:10
10 3 * * * cd /srv/zsb/zsb-qbank && docker compose exec -T app ./scripts/backup.sh >> /var/log/zsb-backup.log 2>&1

# 恢复演练:一条命令走完 备份 → 恢复到临时空库 → 逐表比对 → 删掉临时库
docker compose exec -T app ./scripts/verify-restore.sh

# 手动恢复到指定库(务必是另一个库,别直接盖生产)
docker compose exec -T app psql "$DATABASE_URL" -c 'create database zsb_restore_test'
docker compose exec -T app ./scripts/restore.sh backups/zsb-20260914-031000.dump \
  postgres://zsb:<密码>@db:5432/zsb_restore_test
```

**每季度(或每次改了 schema 之后)跑一次上面那条恢复演练** ——
没验证过的备份等于没有备份。它跑的是真正的 `backup.sh` / `restore.sh`,建一个
`<库名>_restore_check` 临时库灌进去、**把所有表的行数逐张比对**、再把临时库删掉,
全程不碰源库;有一张对不上就非零退出。需要该实例上的 CREATEDB 权限。
源库要是空的(没迁移 / 没数据),它会**拒绝**跑 —— 空库比空库永远相等,那种「通过」什么也没证明。

CI 每次也跑一遍(`zsb-ci.yml`),所以脚本本身不会悄悄烂掉;但那验的是 CI 的库,
**生产上的备份仍要你亲手演练一次**。

`restore.sh` 单独用时会打印 papers / items / attempts / responses 四张表的行数。

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
5. **断网续答**:飞行模式下继续答题(答案先落本地,顶栏显示「离线,已存本机」)→ 恢复网络 →
   顶部同步状态变「已保存」→ 刷新页面答案还在。
5.1 **两台设备别互相盖**(D51):同一个账号在手机和电脑上各打开同一份作答 → 在手机上把某空写错 →
   换到电脑上把它改对 → 回头从**第三台**(或清了缓存的浏览器)打开这份作答,看到的应当是**改对的那个**。
   > 反例(修复前):哪台设备的时钟快,哪台写的就赢 —— 学生改对了也没用。
5.2 **另一台交了卷**(D52):在电脑上交卷 → 回手机那一台继续写 → 顶部应出现
   「这份卷已经交过了(可能是在你的另一台手机上)……点这里去看成绩」,点交卷直接进成绩页,
   而**不是**「还有 N 题没传到服务器,等网络好一点再重试」。
5.3 **弱网交卷不丢分**(硬约束 7 的底线,D47):飞行模式下写两空 → **不**恢复网络就点交卷 →
   应当**交不出去**,弹窗写「还有 N 题没传到服务器……答案都在手机上存着」,而不是跳到成绩页 →
   关飞行模式 → 点「重试」→ 跳成绩页,刚才断网写的两空都算了分。
   > 反例(修复前的行为):交卷成功但那两空没算分,且再也补不回来。见到这种情况立刻停止上线。
6. **断网打开(Service Worker)**:在作答页停留几秒(壳与试卷会被缓存)→ 开飞行模式 →
   **刷新作答页,页面仍打得开、之前的作答还在** → 再打开首页,应看到「现在连不上网」那一页
   (**不是**带着姓名和任务的旧首页——首页不缓存是有意的:手机可能是共用的)→ 关飞行模式,
   刷新恢复正常。
   > 「拔网线后导航还能打得开」这一条只能真机验:Chromium 的离线仿真对 SW 转发的导航请求
   > 不稳定,自动化里写了会时好时坏。`tests/e2e/offline.spec.ts` 因此只断言可自动化的部分:
   > 缓存里有什么、登出会清缓存、**第一次开卷就把壳缓存下来**(D49)、
   > **同步没成功不许交卷 + 恢复后能补传**(D47/D48)。
   > iOS 微信内置浏览器可能不支持 Service Worker,那台机器上这条不通过是预期的,记一句即可;
   > 断网续答(第 5 条)不依赖 SW,仍必须通过。
   > 2026-09-16 已在「浏览器完全没有 `navigator.serviceWorker`」的仿真下验过:作答页照常打开、
   > 作答照常同步、控制台无报错,只是没有离线壳 —— 那台机器上只会缺这一条,不会连累别的。
7. **训练**:首页「每日训练」→ 今日任务 → 答错一题 → 反馈卡提示「1 天后再复习一次」。
8. **输入法**:英文输入框不自动大写、不自动纠错、不弹拼写建议;字号不小于 16 px(聚焦时页面不放大)。
9. **下拉刷新**:考试页下拉不触发浏览器刷新。
10. **性能**:4G 下首页 LCP 主观上「两三秒内出内容」;`pnpm budget` 在 CI 里已保证首屏 JS ≤ 200 KB(gzip)。

记录结果到本文件末尾的「验收记录」表。

---

## 三点五、上线前的空库预演(建议每次大改后做一次)

真机矩阵验的是「手机上好不好用」,这一节验的是「从零部署到能用」这条链路本身。
在一个**全新的空库**上按顺序走一遍,全过才算这套东西能交到老师手里:

```bash
# 另起一个库,别碰生产
createdb -h 127.0.0.1 -U zsb zsb_rehearsal
export DATABASE_URL=postgres://zsb:<密码>@127.0.0.1:5432/zsb_rehearsal
pnpm db:migrate && pnpm seed && pnpm seed     # 第二遍验幂等
pnpm build && AUTH_DEV_LOGIN=true pnpm start
```

然后在浏览器里依次确认:

1. 教师登录 → 「试卷」里种子卷在,状态「已发布」。
2. 「班级」建一个班 → 拿到六位加入码。
3. 「任务」选试卷 + 班级 + 考试模式 → 发布 → 列表出现该任务。
4. 学生登录 → 输入加入码 → 首页「我的任务」出现这个任务。
5. 点「开始考试」→ 顶部倒计时在走;**开浏览器网络面板看 `/api/attempts/:id` 的响应,
   里面不能有 `accepted` / `rubric` / `explanation`**(硬约束 1)。
6. 答几题(含一道主观题)→ 交卷 → 成绩页出分。
7. 等一会儿刷新:主观题不再显示「待评」(AI 判完了);服务端日志有 `[ai] grade job=…`。
8. **整卷一题不答交上去**,成绩页应显示「有 43 题没作答」,**不应**出现「还有 N 题在等 AI 评分」
   ——没作答的题等不来分数,这条 2026-09-15 修过(D44)。
9. 教师端「任务详情」→「发布成绩」(有二次确认)→ 学生成绩页点开某题能看到参考答案与解析。
10. 「看学情 / 导出 CSV」→ 逐题明细出数、有「中位用时」列;CSV 下得下来、能用 Excel 打开。

**训练模式也走一遍**(学生天天用的一块):

13. 学生首页「每日训练」→ 训练页应有 今日任务 / 复习错题 / 专项训练(按题型与知识点抽题)三块。
14. 「开始今日任务」→ 作答框出现 → **故意答错一题**:反馈应给出参考答案 + 解析 + 「这题 1 天后再复习一次」。
15. 答错几题后回训练页:「错题本 N 题」应等于答错数,今日进度「新题 N / 10」跟着走。
16. 第二天(或把 `review_cards.due_at` 调到过去)再进:「今天到期 N 题」应出现「开始复习」,
    点进去能复习同一批题。

**规模也验一下**(你实际是一个班几十人,而上面的步骤只有 1 个学生):

17. 让至少十来个学生交同一份任务(或用脚本造),然后看学情页:**逐题的「作答 / 已交」分母应等于
    实际交卷人数**,正确率与你抽查几题手数的结果一致;CSV 里学生行数 = 交卷人数。
18. 批改页切到「抽查全部主观题」:条数多时会提示「只显示前 500 条,请用上面的任务 / 小题筛选缩小
    范围」——**这时上面的任务 / 小题筛选栏必须是有东西的**(2026-09-15 前它只按「待复核」算,
    AI 全判完时筛选栏是空的,让人无从下手;见 D46)。
19. 改一道分:该生总分应立刻跟着变,那条作答转为「老师评」且不再待复核。

做完把库删掉:`dropdb -h 127.0.0.1 -U zsb zsb_rehearsal`。

**导入一份新试卷也顺带验一下**(这是新内容进系统的唯一入口):

11. 教师端「导入」→ 传一份 .docx → 等解析(每个题组调一次 AI)→ 校对页出现「AI 已补全答案与解析
    （N 次调用），请逐题核对」→ 逐题核对标红处 → 「保存试卷」。
12. 「试卷」列表里新卷显示正确的小题数 → 点「发布」→ **学生端开这份卷,顶栏应显示「已答 0/43」
    而不是「0/0」**。0/0 表示小题没进 approved,学生会拿到一份空卷(2026-09-15 修过,见 D45)。

> 如果你在 2026-09-15 之前导入过试卷,那批小题存的是 `draft`,学生开卷会是空的。
> 一条 SQL 就地修好(把 `<试卷 id>` 换成实际的):
> ```sql
> update items set status = 'approved' where paper_id = '<试卷 id>' and origin = 'official';
> ```
> 只改 `origin='official'` 的,AI 变式题(`origin='ai'`)仍需在试卷页逐题审核。

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
- **训练的「一级脚手架」(给选项)默认见不到**:它需要小题有干扰项(`content.distractors`),
  而真题导入与种子都不带 —— 这时一级会**静默退化成二级(首字母)**,学生只会看到二级和三级。
  想让一级生效:教师端试卷页 → 某道填空 / 汉译英 → 「生成干扰项」→ 采纳。这是设计如此,不是故障。
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
