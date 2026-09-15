import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type RuntimeCaching, type SerwistGlobalConfig, type SerwistPlugin } from 'serwist'
import { decideCache, isDocumentRequest, type CachePolicy } from '@/lib/offline/cache-policy'

// Service Worker(SPEC §9.2「预缓存应用壳,运行时缓存试卷 JSON」;D3 的遗留项)。
//
// 这个应用跑在学生手机上,也可能跑在共用手机上,使用者是未成年人。所以缓存什么、
// 什么时候清,是安全问题而不是性能选项。判断逻辑全在 lib/offline/cache-policy.ts
// (纯函数 + 表驱动用例),这里只负责把策略接上对应的 handler。
//
// 一句话:只缓存不含个人信息的东西(构建产物 + 作答页/成绩页这两张客户端壳),
// 唯一带个人数据的缓存是「进行中的作答」,见到 /api/auth/* 就清掉;计时永不缓存。
//
// 参考答案与评分要点由服务端 stripAnswers 剥掉(硬约束 1),缓存里本就没有。
// 作答的离线保障在 IndexedDB + 同步队列(硬约束 7),不用 Background Sync——
// 少一层看不见的重试更好排障。

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}
declare const self: ServiceWorkerGlobalScope

const SHELL_CACHE = 'zsb-shell-v1'
const ASSET_CACHE = 'zsb-assets-v1'
const ATTEMPT_CACHE = 'zsb-attempt-v1'
/** 只有它装着个人数据(见 cache-policy 的 PERSONAL_CACHE_POLICIES)。 */
const PERSONAL_CACHES = [ATTEMPT_CACHE]

const purgePersonal = () => Promise.all(PERSONAL_CACHES.map((c) => caches.delete(c)))

/** 见到任何 /api/auth/*(登录、回调、登出)就清掉带个人数据的缓存。 */
const purgeOnAuth: SerwistPlugin = {
  handlerDidComplete: async () => {
    await purgePersonal()
  },
  // 登出请求本身失败也要清:本地至少不该继续留着上一个人的卷子。
  handlerDidError: async () => {
    await purgePersonal()
    return undefined
  },
}

/**
 * 把一条策略挂到 handler 上;匹配只认同源请求。
 * 注意 method:Serwist 的路由**默认只处理 GET**,登出是 POST —— 不显式写上,
 * 登出那一下就不会触发清缓存(上一个人的卷子会留在这台手机上)。
 */
const rule = (policy: CachePolicy, handler: RuntimeCaching['handler'], method: RuntimeCaching['method'] = 'GET'): RuntimeCaching => ({
  method,
  matcher: ({ url, request, sameOrigin }) =>
    sameOrigin && decideCache({ pathname: url.pathname, method: request.method, destination: request.destination, mode: request.mode }) === policy,
  handler,
})

const runtimeCaching: RuntimeCaching[] = [
  // 登录 / 回调走 GET,登出走 POST:两种都要清。
  rule('network-only-purge', new NetworkOnly({ plugins: [purgeOnAuth] })),
  rule('network-only-purge', new NetworkOnly({ plugins: [purgeOnAuth] }), 'POST'),
  rule(
    'attempt',
    new NetworkFirst({
      cacheName: ATTEMPT_CACHE,
      networkTimeoutSeconds: 8,
      plugins: [new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 12 * 60 * 60 })],
    }),
  ),
  rule(
    'asset',
    new CacheFirst({ cacheName: ASSET_CACHE, plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 30 * 24 * 60 * 60 })] }),
  ),
  // 应用壳:断网时用缓存的壳把页面撑起来,数据再由上面的作答缓存补上——
  // 两步合起来才是「断网能接着做」。
  rule(
    'shell',
    new NetworkFirst({ cacheName: SHELL_CACHE, networkTimeoutSeconds: 5, plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 7 * 24 * 60 * 60 })] }),
  ),
  rule('network-only', new NetworkOnly()),
]

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // 不开导航预载:它让导航绕开 SW 自己的 fetch 路径,断网时的行为变得不好预测
  // (测试里能观察到「离线了导航却还能成功」),省下的那点首字节不值得。
  navigationPreload: false,
  runtimeCaching,
  // 断网且没有可用缓存时,文档请求兜到 /offline(它在 next.config.ts 里显式预缓存)。
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => isDocumentRequest({ pathname: '', method: request.method, destination: request.destination, mode: request.mode }),
      },
    ],
  },
})

// 升级时清掉上一版留下的旧缓存(缓存名带版本号,改名即失效)。
self.addEventListener('activate', (event: ExtendableEvent) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE, ATTEMPT_CACHE])
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith('zsb-') && !keep.has(n)).map((n) => caches.delete(n)))),
  )
})

serwist.addEventListeners()
