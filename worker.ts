// 自定义 Worker 入口:包装 OpenNext 生成的 handler,在响应侧给 HTML 里的每个 <script>
// 注入本次请求的 CSP nonce(HTMLRewriter,流式、零缓冲)。
//
// 为什么存在(docs/CSP-NONCE-OPENNEXT.md 的续章):严格 CSP(nonce + strict-dynamic)要求
// 页面里每个 script 都带 nonce。Next 只会从「请求头」读 nonce 来给自家脚本盖章,而
// workerd 在两道边界剥掉 CSP 请求头(上游 opennextjs-cloudflare#1302,至今未修)——
// 请求侧此路不通。但响应侧 workerd 管不着:middleware 已把含 nonce 的严格策略写在
// Report-Only 响应头上,这里从中取回同一枚 nonce,在 HTML 流出去的路上补齐所有
// script 的 nonce 属性。运行时动态插入的 chunk 由 'strict-dynamic' 传递信任覆盖。
//
// 两阶段翻转(CSP_ENFORCE var):
//   "report-only"(现值)= 只补 nonce,策略仍 Report-Only——在生产验证 19/19 覆盖、
//     /api/csp-report 违规归零后再进阶段二;
//   "enforce" = 严格策略转正(顶替 next.config.mjs 里带 unsafe-inline 的静态头),
//     Report-Only 头撤下。翻转即改 wrangler.jsonc 一行 + 部署,可随时回退。
//
// 注:本文件在 Next/OpenNext 之外运行,读不到 lib/config(process.env 在入口层未注入),
// 故直接读 env.CSP_ENFORCE——这是「env 只走 lib/config」约定在基础设施层的唯一豁免。

// @ts-ignore — .open-next/worker.js 由 `opennextjs-cloudflare build` 生成,CI 的 tsc 先于构建跑
import openNextHandler from './.open-next/worker.js'
// @ts-ignore — 同上;Durable Object 类必须原样再导出,否则绑定丢失
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js'

const NONCE_IN_POLICY = /'nonce-([A-Za-z0-9+/=]+)'/

export default {
  async fetch(request: Request, env: CloudflareEnv & { CSP_ENFORCE?: string }, ctx: ExecutionContext): Promise<Response> {
    const response: Response = await (openNextHandler as { fetch: (r: Request, e: unknown, c: ExecutionContext) => Promise<Response> }).fetch(request, env, ctx)

    // 只处理 middleware 渲染过的 HTML 文档:非 HTML(静态资源/API/媒体)原样放行;
    // 没有 Report-Only 策略头的 HTML(极端兜底页)也不动——没有 nonce 可取。
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response
    const strictPolicy = response.headers.get('content-security-policy-report-only')
    const nonce = strictPolicy?.match(NONCE_IN_POLICY)?.[1]
    if (!strictPolicy || !nonce) return response

    // 与 middleware 同一枚 nonce(策略字符串里那枚)——主题脚本经 x-nonce 拿到的也是它,
    // 全页一枚章。HTMLRewriter 流式改写,不缓冲响应体。script 之外,
    // <link rel="preload" as="script"> 的预取请求同受 script-src 管辖且不吃
    // strict-dynamic 的传递信任(实测被拦),link 也要盖章。
    const rewritten = new HTMLRewriter()
      .on('script', {
        element(el) {
          el.setAttribute('nonce', nonce)
        },
      })
      .on('link', {
        element(el) {
          const rel = (el.getAttribute('rel') ?? '').toLowerCase()
          const as = (el.getAttribute('as') ?? '').toLowerCase()
          if (rel === 'modulepreload' || (rel === 'preload' && as === 'script')) el.setAttribute('nonce', nonce)
        },
      })
      .transform(response)

    if (env.CSP_ENFORCE !== 'enforce') return rewritten // 阶段一:验证期,策略仍 Report-Only

    // 阶段二:严格策略转正。响应头是我们最后写的,上游没有任何一道边界能再剥它
    // (现行 unsafe-inline 静态头正是这样活到浏览器的)。
    const headers = new Headers(rewritten.headers)
    headers.set('content-security-policy', strictPolicy)
    headers.delete('content-security-policy-report-only')
    return new Response(rewritten.body, { status: rewritten.status, statusText: rewritten.statusText, headers })
  },
}
