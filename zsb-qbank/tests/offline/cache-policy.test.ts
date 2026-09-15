import { describe, it, expect } from 'vitest'
import { decideCache, isDocumentRequest, PERSONAL_CACHE_POLICIES, type CachePolicy } from '@/lib/offline/cache-policy'

// Service Worker 缓存策略(SPEC §9.2)。这些用例守的是安全线,不是性能:
// 手机可能是共用的、使用者是未成年人,任何一条「本该只走网络的却被缓存了」
// 都意味着上一个人的数据留在了这台手机上。

const doc = (pathname: string, method = 'GET') => ({ pathname, method, mode: 'navigate', destination: 'document' })
const api = (pathname: string, method = 'GET') => ({ pathname, method, mode: 'cors', destination: '' })

describe('接口', () => {
  it.each<[string, ReturnType<typeof api>, CachePolicy]>([
    ['进行中的作答:可缓存(断网接着做)', api('/api/attempts/abc-123'), 'attempt'],
    ['作答的写接口:不缓存', api('/api/attempts/abc-123/responses', 'PUT'), 'network-only'],
    ['作答的写接口即使是 GET 也不缓存', api('/api/attempts/abc-123/responses'), 'network-only'],
    ['判分接口:不缓存', api('/api/attempts/abc-123/check', 'POST'), 'network-only'],
    ['交卷:不缓存', api('/api/attempts/abc-123/submit', 'POST'), 'network-only'],
    ['成绩:不缓存', api('/api/attempts/abc-123/result'), 'network-only'],
    ['计时:永远走网络(硬约束 6)', api('/api/time'), 'network-only'],
    ['我的信息:不缓存', api('/api/me'), 'network-only'],
    ['我的统计:不缓存', api('/api/me/stats'), 'network-only'],
    ['任务列表:不缓存', api('/api/assignments'), 'network-only'],
    ['训练取题:不缓存', api('/api/training/next'), 'network-only'],
    ['教师端接口:不缓存', api('/api/teacher/classes'), 'network-only'],
    ['教师端导出:不缓存', api('/api/teacher/assignments/1/export.csv'), 'network-only'],
    ['登录:清个人缓存', api('/api/auth/login'), 'network-only-purge'],
    ['回调:清个人缓存', api('/api/auth/callback'), 'network-only-purge'],
    ['登出:清个人缓存', api('/api/auth/logout', 'POST'), 'network-only-purge'],
  ])('%s', (_name, req, want) => {
    expect(decideCache(req)).toBe(want)
  })

  it('作答缓存只认「一个作答」这一层,多一段路径就不认', () => {
    expect(decideCache(api('/api/attempts/x'))).toBe('attempt')
    expect(decideCache(api('/api/attempts/x/'))).toBe('network-only')
    expect(decideCache(api('/api/attempts'))).toBe('network-only')
    expect(decideCache(api('/api/attempts/x/anything'))).toBe('network-only')
  })

  it('任何写请求都不碰缓存', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'put']) {
      expect(decideCache(api('/api/attempts/abc-123', m))).toBe('network-only')
    }
  })
})

describe('页面', () => {
  it.each<[string, ReturnType<typeof doc>, CachePolicy]>([
    ['作答页:客户端壳,可缓存', doc('/play/abc-123'), 'shell'],
    ['成绩页:客户端壳,可缓存', doc('/result/abc-123'), 'shell'],
    ['首页:服务端渲染带姓名与任务,不缓存', doc('/'), 'network-only'],
    ['训练页:服务端渲染带每日计划,不缓存', doc('/train'), 'network-only'],
    ['断网兜底页:走预缓存,不进运行时规则', doc('/offline'), 'network-only'],
    ['教师端首页:不缓存', doc('/teacher'), 'network-only'],
    ['教师登录页:不缓存', doc('/teacher/login'), 'network-only'],
    ['教师批改页:不缓存', doc('/teacher/grading'), 'network-only'],
  ])('%s', (_name, req, want) => {
    expect(decideCache(req)).toBe(want)
  })

  it('壳预热:页面自己 fetch 自己的 HTML(不是文档请求)也算壳', () => {
    // warm-shell.ts 会这么发一次,好让断网刷新还能打开作答页。
    expect(decideCache({ pathname: '/play/abc', method: 'GET', mode: 'cors', destination: '' })).toBe('shell')
    // 但别的路径不会因为「不是文档请求」就被放行。
    expect(decideCache({ pathname: '/train', method: 'GET', mode: 'cors', destination: '' })).toBe('network-only')
    expect(decideCache({ pathname: '/', method: 'GET', mode: 'cors', destination: '' })).toBe('network-only')
  })

  it('壳的白名单只认这两条路径,别的一律不缓存', () => {
    expect(decideCache(doc('/play/x'))).toBe('shell')
    expect(decideCache(doc('/play/x/y'))).toBe('network-only')
    expect(decideCache(doc('/play'))).toBe('network-only')
    expect(decideCache(doc('/playground'))).toBe('network-only')
    expect(decideCache(doc('/teacher/play/x'))).toBe('network-only')
  })
})

describe('静态资源', () => {
  it.each<[string, { pathname: string; method: string; destination?: string }, CachePolicy]>([
    ['构建产物', { pathname: '/_next/static/chunks/a.js', method: 'GET', destination: 'script' }, 'asset'],
    ['样式', { pathname: '/styles.css', method: 'GET', destination: 'style' }, 'asset'],
    ['字体', { pathname: '/f.woff2', method: 'GET', destination: 'font' }, 'asset'],
    ['图片', { pathname: '/icon.svg', method: 'GET', destination: 'image' }, 'asset'],
    ['manifest 不缓存(内含 start_url 等,随构建变)', { pathname: '/manifest.webmanifest', method: 'GET', destination: '' }, 'network-only'],
  ])('%s', (_name, req, want) => {
    expect(decideCache(req)).toBe(want)
  })

  it('即使放在 /api 下,静态资源判定也不会把接口误判成可缓存', () => {
    expect(decideCache({ pathname: '/api/teacher/items', method: 'GET', destination: 'script' })).toBe('network-only')
  })
})

describe('总则', () => {
  it('带个人数据的策略只有「进行中的作答」一种', () => {
    expect(PERSONAL_CACHE_POLICIES).toEqual(['attempt'])
  })
  it('凡是会落盘的策略,路径要么是构建产物/静态资源,要么在白名单里', () => {
    const cached: CachePolicy[] = ['attempt', 'asset', 'shell']
    const mustNotCache = ['/', '/train', '/teacher', '/teacher/stats', '/api/me', '/api/time', '/api/assignments', '/api/teacher/classes']
    for (const p of mustNotCache) {
      expect(cached).not.toContain(decideCache(doc(p)))
      expect(cached).not.toContain(decideCache(api(p)))
    }
  })
  it('文档请求的判定:navigate 或 destination=document', () => {
    expect(isDocumentRequest({ pathname: '/', method: 'GET', mode: 'navigate' })).toBe(true)
    expect(isDocumentRequest({ pathname: '/', method: 'GET', destination: 'document' })).toBe(true)
    expect(isDocumentRequest({ pathname: '/', method: 'GET', mode: 'cors', destination: '' })).toBe(false)
  })
})
