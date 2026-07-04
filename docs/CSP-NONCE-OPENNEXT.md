# CSP 严格策略：为什么收在 Report-Only（OpenNext/workerd 上游阻塞）

> 状态：**Report-Only（灰度/监控中）**，enforce 翻转阻于上游。
> 相关代码：`src/middleware.ts`（`strictCsp` + 请求头/响应头）、`next.config.mjs`（静态 CSP）、`src/app/api/csp-report/route.ts`（违规上报）。

## TL;DR

安全审计里唯一一条 CSP finding 是 enforced 头带 `script-src 'unsafe-inline'`。我们做了一版严格策略
（`script-src 'self' 'nonce-…' 'strict-dynamic'`，无 `unsafe-inline`），但**目前无法在生产 enforce**：
Cloudflare 的 **workerd 运行时会剥掉 Next 用来给自己脚本打 nonce 的 `content-security-policy` 请求头**。
强行 enforce 会拦掉 Next 的全部框架脚本 → 整站白屏。

因此按评审决定：**收在 Report-Only**（纵深防御项，不给生产打脆弱的框架内部补丁）。当前线上是安全的：
enforced 头照常带 `unsafe-inline`（脚本正常跑），严格策略以 `Content-Security-Policy-Report-Only`
形式并行发出、把 would-be 违规上报到 `/api/csp-report` 做监控。

## 根因（端到端）

要 enforce 一个 nonce-based 的 `strict-dynamic` 策略，Next 必须给它渲染的**每一个**脚本（含 14 个
chunk `<script src>` + 4 个 RSC 内联数据脚本）都打上当次请求的 nonce。Next 的 `app-render`
（`parseRequestHeaders`）**只**从 **`content-security-policy` 请求头**里读取 nonce：

```js
// next/dist/server/app-render/app-render.js
const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
const nonce = typeof csp === 'string' ? getScriptNonceFromHeader(csp) : undefined;
```

我们的 middleware 通过 `NextResponse.next({ request: { headers } })` 把该请求头设进去。实测：

| 环境 | 页面 `<script>` | 带 nonce | 结论 |
|---|---|---|---|
| 本地 `next dev`（同一份代码） | 30 | **30/30** | 机制与我们的代码都正确 |
| 生产（OpenNext/Cloudflare） | 19 | **1/19** | 只有我们自己读 `x-nonce` 的主题脚本 |

差异根因链路：

1. middleware 设的请求头覆盖被 Next 编码成 `x-middleware-request-*`（自定义前缀，一路存活）。
2. OpenNext 的 `@opennextjs/aws` 把这些覆盖解回真名，合并进转发给 Next server 的请求头
   （`core/routing/middleware.js` 的 `{ ...internalEvent.headers, ...reqHeaders }`）。
3. Cloudflare 适配器把 middleware 作为**独立函数**跑（`worker.js` 先 `middlewareHandler(request)`，
   再 `handler(reqOrResp)`），转发用的 `Request` 由 `overrides/converters/edge.js` 的 `convertTo`
   经 **`new Request(url, { headers })`** 重建。
4. **Cloudflare workerd 在这一步剥掉 `content-security-policy` 与 `content-security-policy-report-only`
   请求头**；自定义头（如 `x-nonce`）留得住。

佐证：Node/undici 的 `new Request()` 保留这些头（本地实测都在），所以这是 **workerd 特有行为**，
不是 Fetch 规范的 forbidden request header。于是生产里 app-render 读不到 CSP 请求头 → nonce 为
undefined → Next 不给自己脚本打 nonce；而我们的主题脚本走 `headers().get('x-nonce')`（自定义头，
留得住）所以还带 nonce —— 正好解释了 1/19。

试过但无效的规避：把 nonce 也塞进 `content-security-policy-report-only` 请求头（赌 workerd 只剥精确名
`content-security-policy`）。生产实测（部署 #266）**仍 1/19** —— 两个头都被剥。

版本：`@opennextjs/cloudflare` **1.20.1**（当时最新）、`@opennextjs/aws` 4.0.2、`next` 16.2.9。

## 为什么不打补丁

关闭这条 finding 只剩「给生产打框架内部补丁」一条路，两种都不划算：

- **改 Next 编译产物**（`app-page.runtime.prod.js`，已压缩）让它也从 `x-nonce` 读 nonce：可靠但脆，
  Next 每次升级都要复核 patch。
- **改 OpenNext 的 `edge.js`**（可读源码，patch-package）在 `new Request()` 后把 CSP 头补回：较干净，
  但 workerd 很可能同样拒绝 post-set，成不成得真部署才知道。

这是一条**纵深防御**项（app 目前无已知 XSS 注入点，`unsafe-inline` 只是"万一有 XSS 会更糟"）。
给一个 minors 用的生产站为此长期背一个易碎框架补丁，收益不抵成本 → **收在 Report-Only + 报上游 +
留档**，等上游修好一行翻转。

## 上游修好后，如何翻成 enforced（一行级）

1. `src/middleware.ts`：把响应头从 report-only 改成强制——
   `response.headers.set('content-security-policy-report-only', csp)` → `...set('content-security-policy', csp)`。
2. `next.config.mjs`：删掉 `securityHeaders` 里的 `Content-Security-Policy` 那一项
   （middleware 的 nonce 策略是它的严格超集：多了 `object-src 'none'` 和 `report-uri`，其余 directive 相同）。
   这样 middleware 成为**唯一** CSP 来源，避免两个 enforced 头相交造成困惑。
3. 验证：部署后 `curl https://www.hihomework.com/login`，数 `<script>` 的 `nonce=`；应为 ~全部脚本
   都带 nonce（此前为 1/19）。确认无误再观察 `/api/csp-report` 一段时间。

（判据：只要 `next dev` 是 30/30 而生产也变成 ~全带，即说明 workerd 不再剥该请求头。）

## 上游 Issue 文案（opennextjs/cloudflare）

> **Title:** Middleware request-header override for `content-security-policy` is dropped on Cloudflare, breaking Next.js automatic CSP nonce
>
> **Body:**
>
> Next.js's automatic CSP nonce reads the nonce from the **`content-security-policy` request header** in `app-render` (`parseRequestHeaders`). Setting it from middleware via `NextResponse.next({ request: { headers } })` works under `next dev` (every framework script gets the nonce) but **not** on `@opennextjs/cloudflare`.
>
> **Symptom:** In production, only app-set custom headers (e.g. `x-nonce`) survive; the `content-security-policy` (and `-report-only`) request-header override is missing by the time Next renders, so **0 framework scripts receive the nonce** (verified: 1/19 scripts nonced in prod vs 30/30 under `next dev`). Enforcing a `strict-dynamic` nonce policy therefore blocks all Next scripts and white-screens the app.
>
> **Root cause:** `overrides/converters/edge.js` `convertTo` rebuilds the forwarded request with `new Request(url, { headers })`. Cloudflare's **workerd** runtime strips `content-security-policy` / `content-security-policy-report-only` from request headers at that construction. Node/undici's `new Request()` keeps them, so this is workerd-specific — not a Fetch-spec forbidden request header.
>
> **Versions:** `@opennextjs/cloudflare` 1.20.1, `@opennextjs/aws` 4.0.2, `next` 16.2.9.
>
> **Suggested fix:** re-apply the CSP request header(s) after `new Request()` (e.g. `request.headers.set(...)`), or otherwise carry them through in a workerd-safe way, so Next's nonce reader sees them.
