import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ID_TOKEN_HINT_MAX,
  buildEndSessionUrl,
  discoveryEndpoint,
  endSessionEndpoint,
  getOidcConfig,
  idTokenForHint,
  resetDiscoveryCache,
} from '@/lib/auth/oidc'

// 单点登出(OIDC RP-Initiated Logout 1.0)。
//
// 这条链路的要害不是「跳得成」,而是**跳不成的时候不能把人卡住**:登出端点是问身份服务器
// 要来的,身份服务器可以不可达、可以超时、可以压根没公布这个端点。每一条都得安静地退回
// 本地登出。所以下面失败路径的用例比成功路径多。
//
// 另一个要害是那个地址会被原样 302 给学生的浏览器:发现文档给什么就跳什么 = 开放重定向。

const ENV = {
  CASDOOR_ISSUER: 'https://id.example.com/',
  CASDOOR_CLIENT_ID: 'zsb-qbank',
  CASDOOR_CLIENT_SECRET: 's3cret',
  APP_ORIGIN: 'https://zsb.example.com',
}
const cfg = getOidcConfig(ENV)!
const END_SESSION = 'https://id.example.com/api/end-session'

const fakeFetch = (status: number, body: unknown, capture?: (url: string) => void) =>
  (async (url: string | URL | Request) => {
    capture?.(String(url))
    return { ok: status < 400, status, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch

const boomFetch = (async () => {
  throw new Error('ECONNREFUSED')
}) as unknown as typeof fetch

/** 永不自己结束的 fetch:只有被 AbortController 掐断才 reject —— 用来验超时那根线真的接着。 */
const hangingFetch = ((_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })) as unknown as typeof fetch

beforeEach(() => {
  resetDiscoveryCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('取登出端点', () => {
  it('问标准的发现地址,取 end_session_endpoint', async () => {
    let seen = ''
    const got = await endSessionEndpoint(cfg, fakeFetch(200, { end_session_endpoint: END_SESSION }, (u) => (seen = u)))
    expect(got).toBe(END_SESSION)
    expect(seen).toBe('https://id.example.com/.well-known/openid-configuration')
    expect(seen).toBe(discoveryEndpoint(cfg))
  })

  it('同一个 issuer 只问一次:第二次即使问不到也照样给出上次的结果', async () => {
    let calls = 0
    await endSessionEndpoint(cfg, fakeFetch(200, { end_session_endpoint: END_SESSION }, () => calls++))
    const second = await endSessionEndpoint(cfg, boomFetch)
    expect(second).toBe(END_SESSION)
    expect(calls).toBe(1)
  })

  it.each([
    ['身份服务器没公布这个端点', fakeFetch(200, { issuer: 'https://id.example.com' })],
    ['字段是空串', fakeFetch(200, { end_session_endpoint: '   ' })],
    ['字段不是字符串', fakeFetch(200, { end_session_endpoint: { url: END_SESSION } })],
    ['发现文档 500', fakeFetch(500, {})],
    ['发现文档不是 JSON', (async () => ({ ok: true, status: 200, json: async () => JSON.parse('{') }) as unknown as Response) as unknown as typeof fetch],
    ['连不上', boomFetch],
  ])('%s → 回 null,由上层退回本地登出', async (_name, f) => {
    await expect(endSessionEndpoint(cfg, f)).resolves.toBeNull()
  })

  it('超时:到点掐断,不把登出请求吊在那儿', async () => {
    await expect(endSessionEndpoint(cfg, hangingFetch, 5)).resolves.toBeNull()
  })

  // 发现文档来自 issuer 本身,但它给的地址我们会原样 302 给学生的浏览器。
  // 换个域名就是一个挂在学校域名上的开放重定向 —— 和 safeReturnTo 防的是同一件事。
  it.each([
    ['换了域名', 'https://evil.com/api/end-session'],
    ['换了端口', 'https://id.example.com:8443/api/end-session'],
    ['降级成 http', 'http://id.example.com/api/end-session'],
    ['根本不是地址', '/api/end-session'],
    ['javascript 伪协议', 'javascript:alert(1)'],
  ])('登出端点与 issuer 不同源(%s)→ 不跳', async (_name, endpoint) => {
    await expect(endSessionEndpoint(cfg, fakeFetch(200, { end_session_endpoint: endpoint }))).resolves.toBeNull()
  })

  it('失败不进缓存:身份服务器缓过来,下一次登出就能跳了', async () => {
    await expect(endSessionEndpoint(cfg, boomFetch)).resolves.toBeNull()
    await expect(endSessionEndpoint(cfg, fakeFetch(200, { end_session_endpoint: END_SESSION }))).resolves.toBe(END_SESSION)
  })
})

describe('拼登出跳转地址', () => {
  it('带 client_id / post_logout_redirect_uri / id_token_hint', () => {
    const u = new URL(buildEndSessionUrl(END_SESSION, cfg, { idToken: 'h.e30.s', postLogoutRedirectUri: 'https://zsb.example.com/' }))
    expect(u.origin + u.pathname).toBe(END_SESSION)
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'zsb-qbank',
      post_logout_redirect_uri: 'https://zsb.example.com/',
      id_token_hint: 'h.e30.s',
    })
  })

  it('没有 id_token 也拼得出来(少一个 hint 而已,不是错误)', () => {
    const u = new URL(buildEndSessionUrl(END_SESSION, cfg, { postLogoutRedirectUri: 'https://zsb.example.com/' }))
    expect(u.searchParams.has('id_token_hint')).toBe(false)
    expect(u.searchParams.get('client_id')).toBe('zsb-qbank')
  })

  it('端点自带查询串时只追加,不覆盖', () => {
    const u = new URL(buildEndSessionUrl(`${END_SESSION}?tenant=hb`, cfg, { postLogoutRedirectUri: 'https://zsb.example.com/' }))
    expect(u.searchParams.get('tenant')).toBe('hb')
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe('https://zsb.example.com/')
  })
})

describe('id_token 存不存进会话', () => {
  it('正常大小的存;超限的不存 —— 为登出方便把登录搞坏不划算', () => {
    expect(idTokenForHint('h.e30.s')).toBe('h.e30.s')
    expect(idTokenForHint('x'.repeat(ID_TOKEN_HINT_MAX))).toHaveLength(ID_TOKEN_HINT_MAX)
    expect(idTokenForHint('x'.repeat(ID_TOKEN_HINT_MAX + 1))).toBeUndefined()
    expect(idTokenForHint(undefined)).toBeUndefined()
    expect(idTokenForHint('  ')).toBeUndefined()
  })
})
