# CSP 严格策略：为什么收在 Report-Only（OpenNext/workerd 的两道剔头 + 压缩运行时）

> 状态：**Report-Only（监控中）**。enforce 阻于 Cloudflare/OpenNext，非我们代码问题。
> **上游追踪：https://github.com/opennextjs/opennextjs-cloudflare/issues/1302** —— 修复后即可
> 按下文「何时/如何真正 enforce」一节翻转。
> 相关：`src/middleware.ts`、`next.config.mjs`（静态 CSP，带 unsafe-inline 的强制头）、
> `src/app/api/csp-report/route.ts`（违规上报）。

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
