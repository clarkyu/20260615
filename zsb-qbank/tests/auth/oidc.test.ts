import { describe, it, expect } from 'vitest'
import {
  CLOCK_SKEW_S,
  OidcError,
  authorizeEndpoint,
  buildAuthorizeUrl,
  codeChallengeOf,
  decodeJwtPayload,
  exchangeCode,
  getOidcConfig,
  landingFor,
  mapRole,
  newAuthRequest,
  oidcConfigured,
  toSessionUser,
  tokenEndpoint,
  validateClaims,
  type IdTokenClaims,
  type OidcConfig,
} from '@/lib/auth/oidc'
import { createHash } from 'node:crypto'

// Casdoor / OIDC 登录(SPEC §9.1:授权码 + PKCE):纯函数表驱动 + 假 token 端点。

const ENV = {
  CASDOOR_ISSUER: 'https://id.example.com/',
  CASDOOR_CLIENT_ID: 'zsb-qbank',
  CASDOOR_CLIENT_SECRET: 's3cret',
  APP_ORIGIN: 'https://zsb.example.com',
}
const cfg = getOidcConfig(ENV)!

describe('配置', () => {
  it('三项齐全才算配置好;issuer 去尾斜杠;回调地址由 APP_ORIGIN 推出', () => {
    expect(cfg).toMatchObject({ issuer: 'https://id.example.com', clientId: 'zsb-qbank', redirectUri: 'https://zsb.example.com/api/auth/callback' })
    expect(getOidcConfig({ ...ENV, CASDOOR_CLIENT_SECRET: '' })).toBeNull()
    expect(getOidcConfig({ ...ENV, CASDOOR_ISSUER: undefined })).toBeNull()
    expect(oidcConfigured(ENV)).toBe(true)
    expect(oidcConfigured({})).toBe(false)
  })
  it('显式回调地址优先;APP_ORIGIN 缺失时用请求来源;都没有则视为未配置', () => {
    expect(getOidcConfig({ ...ENV, CASDOOR_REDIRECT_URI: 'https://a.cn/cb' })!.redirectUri).toBe('https://a.cn/cb')
    expect(getOidcConfig({ ...ENV, APP_ORIGIN: undefined }, 'http://localhost:3000')!.redirectUri).toBe('http://localhost:3000/api/auth/callback')
    expect(getOidcConfig({ ...ENV, APP_ORIGIN: undefined })).toBeNull()
  })
  it('端点按 Casdoor 约定拼;默认组名可覆盖', () => {
    expect(authorizeEndpoint(cfg)).toBe('https://id.example.com/login/oauth/authorize')
    expect(tokenEndpoint(cfg)).toBe('https://id.example.com/api/login/oauth/access_token')
    expect(cfg.teacherGroups).toEqual(['teacher', '教师'])
    expect(getOidcConfig({ ...ENV, CASDOOR_TEACHER_GROUPS: 'faculty, 老师' })!.teacherGroups).toEqual(['faculty', '老师'])
  })
})

describe('PKCE 与授权链接', () => {
  it('challenge = base64url(sha256(verifier)),无填充', () => {
    const v = 'test-verifier-123'
    const want = createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(codeChallengeOf(v)).toBe(want)
    expect(codeChallengeOf(v)).not.toMatch(/[+/=]/)
  })
  it('每次的 state / nonce / verifier 都不同且足够长', () => {
    const a = newAuthRequest()
    const b = newAuthRequest()
    expect(a.state).not.toBe(b.state)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.verifier.length).toBeGreaterThanOrEqual(43) // RFC 7636 下限
  })
  it('授权链接带齐 response_type / client_id / redirect_uri / scope / state / nonce / S256', () => {
    const req = { state: 'st', nonce: 'no', verifier: 'ver' }
    const u = new URL(buildAuthorizeUrl(cfg, req))
    expect(u.origin + u.pathname).toBe(authorizeEndpoint(cfg))
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'zsb-qbank',
      redirect_uri: 'https://zsb.example.com/api/auth/callback',
      scope: 'openid profile email',
      state: 'st',
      nonce: 'no',
      code_challenge: codeChallengeOf('ver'),
      code_challenge_method: 'S256',
    })
  })
})

describe('id_token 校验', () => {
  const now = Date.parse('2026-09-14T12:00:00Z')
  const base: IdTokenClaims = { iss: 'https://id.example.com', aud: 'zsb-qbank', sub: 'u1', exp: Math.floor(now / 1000) + 3600, iat: Math.floor(now / 1000), nonce: 'no' }
  const jwt = (claims: IdTokenClaims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

  it('解析载荷(base64url,容忍无填充);坏 token 返回 null', () => {
    expect(decodeJwtPayload(jwt(base))).toMatchObject({ sub: 'u1' })
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
    expect(decodeJwtPayload('a.@@@.c')).toBeNull()
  })
  it.each([
    ['合法', base, null],
    ['issuer 不匹配', { ...base, iss: 'https://evil.com' }, 'issuer 不匹配'],
    ['issuer 带尾斜杠也算匹配', { ...base, iss: 'https://id.example.com/' }, null],
    ['aud 数组含 clientId', { ...base, aud: ['other', 'zsb-qbank'] }, null],
    ['aud 不含 clientId', { ...base, aud: 'other' }, 'audience 不匹配'],
    ['nonce 不匹配', { ...base, nonce: 'x' }, 'nonce 不匹配'],
    ['缺 sub', { ...base, sub: undefined }, 'id_token 缺少 sub'],
    ['已过期', { ...base, exp: Math.floor(now / 1000) - CLOCK_SKEW_S - 1 }, 'id_token 已过期'],
    ['刚过期但在时钟偏移内', { ...base, exp: Math.floor(now / 1000) - 1 }, null],
    ['签发时间在未来', { ...base, iat: Math.floor(now / 1000) + CLOCK_SKEW_S + 60 }, 'id_token 签发时间在未来'],
  ])('%s', (_name, claims, want) => {
    expect(validateClaims(claims as IdTokenClaims, cfg, 'no', now)).toBe(want)
  })
  it('解析失败也被挡住', () => {
    expect(validateClaims(null, cfg, 'no', now)).toBe('id_token 解析失败')
  })
})

describe('角色映射与会话用户', () => {
  it.each([
    [{ groups: ['student'] }, 'student'],
    [{ groups: ['teacher'] }, 'teacher'],
    [{ groups: ['教师'] }, 'teacher'],
    [{ roles: 'teacher' }, 'teacher'],
    [{ groups: ['Teacher'] }, 'teacher'], // 大小写不敏感
    [{ groups: ['admin'] }, 'admin'],
    [{ groups: ['teacher', 'admin'] }, 'admin'], // admin 优先
    [{ groups: 'a,b' }, 'student'],
    [{}, 'student'],
  ])('%s → %s', (claims, want) => {
    expect(mapRole({ ...claims } as IdTokenClaims, cfg)).toBe(want)
  })
  it('sub 带身份源前缀;姓名取第一个可用字段;只取 sub / 姓名 / 角色', () => {
    const u = toSessionUser({ sub: 'u1', displayName: ' 王老师 ', name: 'wang', email: 'w@x.cn', phone: '13800000000', groups: ['teacher'] }, cfg)
    expect(u).toEqual({ sub: 'casdoor:u1', name: '王老师', role: 'teacher' })
    expect(Object.keys(u).sort()).toEqual(['name', 'role', 'sub'])
    expect(toSessionUser({ sub: 'u2' }, cfg).name).toBe('同学')
    expect(toSessionUser({ sub: 'u3', preferred_username: 'xiaoming' }, cfg).name).toBe('xiaoming')
  })
  it('落地页:学生回首页、教师进教师端;returnTo 只接受站内相对路径', () => {
    expect(landingFor('student')).toBe('/')
    expect(landingFor('teacher')).toBe('/teacher')
    expect(landingFor('student', '/train')).toBe('/train')
    expect(landingFor('student', 'https://evil.com')).toBe('/')
    expect(landingFor('teacher', '//evil.com')).toBe('/teacher')
  })
})

describe('token 交换', () => {
  const okBody = { id_token: 'h.e30.s', access_token: 'at', token_type: 'Bearer' }
  const fakeFetch = (status: number, body: unknown, capture?: (url: string, init: RequestInit) => void) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      capture?.(String(url), init ?? {})
      return { ok: status < 400, status, json: async () => body } as unknown as Response
    }) as unknown as typeof fetch

  it('POST 到 token 端点,带 code / verifier / client_secret / redirect_uri', async () => {
    let seenUrl = ''
    let seenBody = ''
    const f = fakeFetch(200, okBody, (url, init) => {
      seenUrl = url
      seenBody = String(init.body)
    })
    const out = await exchangeCode(cfg, { code: 'c1', verifier: 'v1' }, f)
    expect(out.id_token).toBe('h.e30.s')
    expect(seenUrl).toBe(tokenEndpoint(cfg))
    const p = new URLSearchParams(seenBody)
    expect(Object.fromEntries(p)).toEqual({
      grant_type: 'authorization_code',
      code: 'c1',
      redirect_uri: cfg.redirectUri,
      client_id: 'zsb-qbank',
      client_secret: 's3cret',
      code_verifier: 'v1',
    })
  })
  it('错误响应 / 缺 id_token / 连不上都抛中文 OidcError', async () => {
    await expect(exchangeCode(cfg, { code: 'c', verifier: 'v' }, fakeFetch(400, { error: 'invalid_grant', error_description: '授权码已用过' }))).rejects.toBeInstanceOf(OidcError)
    await expect(exchangeCode(cfg, { code: 'c', verifier: 'v' }, fakeFetch(200, { access_token: 'at' }))).rejects.toThrow(/id_token/)
    const boom = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    await expect(exchangeCode(cfg, { code: 'c', verifier: 'v' }, boom)).rejects.toThrow('连不上身份服务器')
  })
  it('整条链路:交换 → 解析 → 校验 → 会话用户', async () => {
    const now = Date.now()
    const claims: IdTokenClaims = { iss: cfg.issuer, aud: cfg.clientId, sub: 'u9', exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000), nonce: 'N1', displayName: '李老师', groups: ['teacher'] }
    const idToken = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
    const out = await exchangeCode(cfg, { code: 'c', verifier: 'v' }, fakeFetch(200, { id_token: idToken }))
    const parsed = decodeJwtPayload(out.id_token!)
    expect(validateClaims(parsed, cfg, 'N1', now)).toBeNull()
    expect(toSessionUser(parsed!, cfg)).toEqual({ sub: 'casdoor:u9', name: '李老师', role: 'teacher' })
  })
})
