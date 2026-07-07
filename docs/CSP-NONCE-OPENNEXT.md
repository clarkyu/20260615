# CSP 严格策略：为什么收在 Report-Only（OpenNext/workerd 的两道剔头 + 压缩运行时）

> 状态：**已突破——响应侧 HTMLRewriter 方案落地(见文末「响应侧突围」)**。阶段一
> (全量 nonce 注入 + 仍 Report-Only)已上线验证;阶段二翻转 = `wrangler.jsonc` 的
> `CSP_ENFORCE` 改 `"enforce"` 一行 + 部署。上游 #1302 依旧未修,但已不再挡路。
> 相关：`src/middleware.ts`、`next.config.mjs`（静态 CSP，带 unsafe-inline 的强制头）、
> `src/app/api/csp-report/route.ts`（违规上报）。

> **定期复查记录（能否翻转 enforce）**——上游任一修复落地即可按末节「一行翻转」：
>
> | 复查日期 | 上游 #1302 | `@opennextjs/cloudflare`（已装 / 最新发布） | 结论 |
> |---|---|---|---|
> | 2026-07-05 | 仍 **open**，无关联 PR / 无修复 / 无 workaround | `1.20.1` / `1.20.1`（已是最新，无新版本） | **维持 Report-Only**，无可翻转项；强行 enforce 会拦掉生产绝大多数脚本（1/19 带 nonce） |
> | 2026-07-07 | 仍 **open**，零回应 | `1.20.1` / `1.20.1` | **换思路突围**:不等上游,响应侧 HTMLRewriter 注入 nonce(见文末),本地 workerd 实测 19/19 + enforce 下浏览器零违规 |

## 目标与结论

审计唯一一条 CSP finding：enforced 头带 `script-src 'unsafe-inline'`（万一有 XSS 更糟）。
目标是改成 `script-src 'self' 'nonce-…' 'strict-dynamic'`（无 unsafe-inline）并 enforce。

**结论：在当前 Cloudflare + OpenNext + Next 组合下无法干净地 enforce**，除非改 Next 的
**压缩运行时**（极脆，每次 Next 升级都可能失效）。经评审决定**收在 Report-Only**——这是纵深
防御项、生产给 minors 用，不值得为它长期背一个易碎的框架压缩产物补丁。

## 要 enforce 必须让 Next 给自己每个脚本打 nonce

`strict-dynamic` + nonce 的策略要求页面里**每个** `<script>`（14 个 chunk + 4 个 RSC 内联
数据脚本）都带当次 nonce。Next 的 nonce 来自请求头：

```js
// next/dist/server/app-render/app-render.js parseRequestHeaders(req.headers)
const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
const nonce = typeof csp === 'string' ? getScriptNonceFromHeader(csp) : undefined;
```

实测：本地 `next dev` **30/30** 脚本带 nonce（机制与我们代码都对）；生产 **1/19**（只有我们
自己读 `x-nonce` 的主题脚本）。

## 排查：两道剔头 + 一份「不是它」的可读源码

我们的 middleware 用 `NextResponse.next({ request: { headers } })` 设 `content-security-policy`
请求头。生产失效的完整链路，逐一验证如下：

**① workerd 在转发时剥掉 CSP 请求头。** Cloudflare 把 middleware 作为独立函数跑，转发用的
`Request` 由 `@opennextjs/aws` 的 edge 转换器 `new Request(url,{headers})` 重建；workerd 在此
剥掉 `content-security-policy`（和 `-report-only`），但放行自定义头 `x-nonce`。佐证：Node/undici
的 `new Request()` 保留这些头 → workerd 特有，非 Fetch 规范禁用头。（也试过换 `-report-only`
头名塞 nonce，生产同样被剥，无效。）

**② 在 edge 转换器 `convertFrom` 里从 `x-nonce` 恢复 CSP —— 恢复出来的头又被二次剔。**
用一次性诊断部署把「恢复值」编码进脚本 nonce，线上 curl **没有任何该标记** → 恢复出来的
`content-security-policy` 在到达 Next `app-render` 之前，被真 Cloudflare 一道**本地 `wrangler dev`
复现不出来**的边界再次剥掉。（本地最保真模拟 19/19，真生产 1/19，即由此而来。）

**③ 回退到读 `x-nonce` 的 Next 补丁 —— 打在了「不是生产用的那份」可读源码上。**
给 `app-render.js`（CJS + ESM 两份可读源码）打「nonce 回退读 x-nonce」补丁并本地 workerd 验证，
框架脚本**连调试标记 nonce 都拿不到** → 生产构建给框架脚本打 nonce 用的是 Next 的**压缩运行时**
`app-page.runtime.prod.js`，不是这两份可读 `app-render.js`。要改就得改压缩产物。

版本：`@opennextjs/cloudflare` 1.20.1、`@opennextjs/aws` 4.0.2、`next` 16.2.9。

## 当前状态（安全）

- enforced `Content-Security-Policy`（next.config.mjs）：`script-src 'self' 'unsafe-inline'`，
  脚本正常跑，跟多数 Next-on-CF 应用一致。
- middleware 并行发 `Content-Security-Policy-Report-Only`（严格 nonce 策略），`/api/csp-report`
  收违规——持续监控，且 report-only 不 enforce，零破坏。
- middleware 仍设 `content-security-policy` 请求头：`next dev` 下有效、且上游修复后可直接生效；
  生产今日是无害空操作。

## 何时/如何真正 enforce

任一上游修复即可解锁「一行翻转」：

- **OpenNext/workerd 不再剥 CSP 请求头**（②那道边界），或
- **Next 支持从自定义头/其它稳定机制读 nonce**（免得碰压缩运行时）。

届时把 `src/middleware.ts` 的响应头从 `-report-only` 改成 `content-security-policy`（强制），
并删掉 `next.config.mjs` 里带 unsafe-inline 的静态 CSP（middleware 策略是其严格超集）。

## 上游修法分析（给维护者/将来参考）

核心原理：**那个 CSP 值在「普通对象/自定义头」上活得好好的，一旦被放进 workerd 的 `Request`
对象就被剥。** 所以修法本质都是——**别让它经过 workerd 的 `Request`，或在最后一次 `Request`
重建之后、喂给 Next 渲染之前，再把它落回普通请求头。** 三个可下手处：

**1) OpenNext 侧（最可能、最该他们修，不碰 runtime/Next）。**
链路：middleware（独立函数）→ 转发 `Request` → server 函数 → 建 `IncomingMessage` → Next 渲染。
已精确定位第一道剔头是 `overrides/converters/edge.js` 的 `convertTo`（`new Request(url,{headers})`）；
且已证明**在 `convertFrom` 里恢复无效**——到 `app-render` 前还有第二道边界再剥（诊断部署把恢复值
编码进 nonce、线上收不到，即由此测出）。真正该做的：用 workerd 不剥的载体（如自定义头 `x-nonce`
或内部字段）把 nonce/CSP 一路带过去，在**建 `IncomingMessage`（喂给 NextServer 的普通 Node 风格
headers，不是 workerd `Request`）时再写回 `content-security-policy`**——之后无 `Request` 重建，能活到
`app-render`。大概率落在 `core/requestHandler`/`core/routing/util` 建请求那一层。

**2) workerd/Cloudflare 侧（治本，但更大）。** 让 workerd 别在 `new Request()` 时剥
`content-security-policy` 请求头（Node/undici 都不剥）。一劳永逸，但动 runtime、推进慢。

**3) Next 侧（feature，绕开该头）。** Next 现写死只从 `content-security-policy`/`-report-only`
请求头读 nonce。若 Next 支持**配置读哪个头**（或从稳定通道拿 nonce），OpenNext 把 nonce 塞进
workerd 不剥的头即可，彻底绕过。属给 Next 的 feature request。

**最现实是 #1**——在 OpenNext 里改。上游任一落地后，按上一节「一行翻转」收。

## 上游 Issue 文案（opennextjs/cloudflare）

> 已提交：**https://github.com/opennextjs/opennextjs-cloudflare/issues/1302**（下为原文，留档）。

> **Title:** CSP request header stripped on Cloudflare — Next.js automatic script nonce doesn't work
>
> **Body:** Next.js auto-nonce reads the nonce from the `content-security-policy` request header
> (`app-render` `parseRequestHeaders`). Setting it from middleware via
> `NextResponse.next({ request: { headers } })` works under `next dev` (every script nonced) but
> not on `@opennextjs/cloudflare`: **1/19 scripts nonced in prod vs 30/30 under `next dev`**.
> workerd strips `content-security-policy` (and `-report-only`) from request headers when the
> edge converter rebuilds the forwarded `Request` (`overrides/converters/edge.js` `convertTo`,
> `new Request(url,{headers})`); custom headers like `x-nonce` survive. Restoring the header in
> the converter's `convertFrom` does not help — it is stripped again before Next reads it. Node/
> undici keep these headers, so this is workerd-specific, not a Fetch-spec forbidden header.
> Versions: `@opennextjs/cloudflare` 1.20.1, `@opennextjs/aws` 4.0.2, `next` 16.2.9. Suggested
> fix: carry the CSP request header through to the server render in a workerd-safe way (e.g.
> restore it after the final `Request` reconstruction, or expose the nonce Next can read).

## 响应侧突围(2026-07-07,不再等上游)

上文三道死路都在「请求侧」——想让 Next 在渲染时拿到 nonce。换路:**渲染完再补章**。
自定义 Worker 入口 `worker.ts` 包装 OpenNext 生成的 handler,对每个 HTML 响应:

1. 从 middleware 已发的 Report-Only 头里取回**同一枚** nonce(单一事实来源,与主题脚本
   经 x-nonce 拿到的是同一枚);
2. `HTMLRewriter`(workerd 原生,流式零缓冲)给每个 `<script>` **和**
   `<link rel="preload" as="script">` / `modulepreload` 盖 nonce 章——preload 请求同受
   script-src 管辖且不吃 `strict-dynamic` 传递信任,实测漏它会报违规;
3. 运行时动态插入的 chunk 由 `'strict-dynamic'` 传递信任覆盖(这正是它的设计用途);
4. `CSP_ENFORCE` var 两阶段:`"report-only"`(现值)只补 nonce、策略仍 Report-Only;
   `"enforce"` 时严格策略转正为 `content-security-policy`、撤下 Report-Only、
   顶替 next.config.mjs 的 unsafe-inline 静态头。

为什么这条路不会重蹈覆辙:workerd 剥的是**请求头**;响应头是我们**最后**写的,上游没有
任何一道边界再处理它(现行 unsafe-inline 静态头正是这样活到浏览器的)。

本地 workerd(`wrangler dev`,与生产同引擎)实测:
- report-only 模式:19/19 脚本带 nonce,头体 nonce 一致;
- enforce 模式:严格策略转正、Report-Only 撤下,真浏览器加载 + 水合 + 交互,
  **CSP 违规 0 条**(修 preload 前有 1 条,即上文第 2 点的由来)。

### 剩余翻转步骤(阶段二)

生产验证清单(阶段一部署后):`curl -s https://www.hihomework.com/login | grep -c nonce=`
应为全量;`/api/csp-report` 观察 1-2 天归零。然后:
1. `wrangler.jsonc` 里 `CSP_ENFORCE` 改 `"enforce"`,部署;
2. (可选清理)删 `next.config.mjs` 的静态 CSP(worker 层已顶替)与 middleware 里
   现在冗余的请求头设置。回退 = 改回 `"report-only"` 再部署,秒级。

已知边界:若未来 `opennextjs-cloudflare deploy` 强制覆盖 `main` 配置,包装层会失效——
症状是生产 nonce 覆盖跌回 1/19、report-only 违规暴涨,但**阶段一下零破坏**(策略仍
Report-Only),诊断页/上报会先叫。
