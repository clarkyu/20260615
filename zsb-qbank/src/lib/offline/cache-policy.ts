// Service Worker 的缓存策略(SPEC §9.2;硬约束 1 / 6 / 7 的落点)。
//
// 单独拿出来做纯函数,是因为「缓存什么」在这个应用里是安全问题:学生是未成年人,
// 手机可能是共用的,缓存错一条就等于把上一个人的卷子留在了这台手机上。
// 纯函数 + 表驱动用例,改错了会被测试挡住 —— 和判分规则同一个思路。
//
// sw.ts 只按本文件返回的策略挂 handler,不再自己判断路径。

export type CachePolicy =
  /** 只走网络,并且清掉带个人数据的缓存(登录 / 回调 / 登出:可能换人了) */
  | 'network-only-purge'
  /** 只走网络,不留任何副本 */
  | 'network-only'
  /** 进行中的作答:先网络,断网回缓存(唯一一份带个人数据的缓存) */
  | 'attempt'
  /** 构建产物与静态资源:内容哈希命名,可长期缓存 */
  | 'asset'
  /** 应用壳 HTML:不含个人信息的客户端页面 */
  | 'shell'

export interface CacheRequest {
  pathname: string
  method: string
  /** fetch 的 request.destination */
  destination?: string
  /** fetch 的 request.mode */
  mode?: string
}

/** 作答页与成绩页是客户端组件,HTML 里没有学生数据(数据走 /api/attempts/:id)。 */
const SHELL_PATH = /^\/(play|result)\/[^/]+\/?$/
/** 只认「一个作答的详情」,不含 /responses、/check、/submit 这些写接口与判分接口。 */
const ATTEMPT_PATH = /^\/api\/attempts\/[^/]+$/

export function isDocumentRequest(req: CacheRequest): boolean {
  return req.mode === 'navigate' || req.destination === 'document'
}

/**
 * 决定一个同源请求怎么缓存。顺序即优先级,前面的规则先命中。
 * 跨源请求不走这里(sw.ts 只对 sameOrigin 应用规则)。
 */
export function decideCache(req: CacheRequest): CachePolicy {
  const { pathname } = req
  const method = req.method.toUpperCase()

  // 写请求一律不碰缓存:离线保障在 IndexedDB + 同步队列(硬约束 7),不做 Background Sync。
  if (method !== 'GET' && method !== 'HEAD') {
    return pathname.startsWith('/api/auth/') ? 'network-only-purge' : 'network-only'
  }

  // 登录 / 回调 / 登出:可能换人了,清掉带个人数据的缓存。
  if (pathname.startsWith('/api/auth/')) return 'network-only-purge'

  // 考试计时以服务端为准(硬约束 6),绝不能回一个旧时间。
  if (pathname === '/api/time') return 'network-only'

  // 进行中的作答:缓存它才谈得上「断网了还能接着做」。
  if (ATTEMPT_PATH.test(pathname)) return 'attempt'

  // 其余接口(/api/me、/api/assignments、教师端接口……)一律不缓存。
  if (pathname.startsWith('/api/')) return 'network-only'

  // 构建产物:文件名带内容哈希。
  if (pathname.startsWith('/_next/static/')) return 'asset'

  // 应用壳:这两条路径的响应不含个人信息,无论是整页打开还是页面自己预热(见 warm-shell.ts)
  // 都可以缓存。别的页面(首页 / 训练页 / 教师端)是服务端渲染带姓名与任务的,一律不缓存。
  if (SHELL_PATH.test(pathname)) return 'shell'
  if (isDocumentRequest(req)) return 'network-only'

  // 其它静态资源(样式、脚本、字体、图片)。
  if (['style', 'script', 'font', 'image'].includes(req.destination ?? '')) return 'asset'

  return 'network-only'
}

/** 这些缓存装着个人数据,登录 / 登出时必须清掉。 */
export const PERSONAL_CACHE_POLICIES: CachePolicy[] = ['attempt']
