// 裸模块名而非 node: 前缀:与 lib/ai/prompts.ts 同理,edge 编译会按 next.config 的别名置空。
import { createHash, randomBytes } from 'crypto'
import type { SessionUser } from './session'

// Casdoor / OIDC 登录(SPEC §9.1:授权码 + PKCE)。
// 这里只放纯逻辑与一次 fetch 的 token 交换,路由负责 Cookie 与跳转。
// 配置缺失即视为「未接入」,上层退回开发登录(D2)。

export interface OidcConfig {
  issuer: string
  clientId: string
  clientSecret: string
  /** 回调地址;不配则由请求来源 + /api/auth/callback 推出 */
  redirectUri: string
  scope: string
  /** 命中即判为教师 / 管理员的组或角色名(逗号分隔配) */
  teacherGroups: string[]
  adminGroups: string[]
}

export function getOidcConfig(env: Record<string, string | undefined> = process.env, origin?: string | null): OidcConfig | null {
  const issuer = env.CASDOOR_ISSUER?.trim().replace(/\/+$/, '')
  const clientId = env.CASDOOR_CLIENT_ID?.trim()
  const clientSecret = env.CASDOOR_CLIENT_SECRET?.trim()
  if (!issuer || !clientId || !clientSecret) return null
  const configured = env.CASDOOR_REDIRECT_URI?.trim()
  const base = (env.APP_ORIGIN?.split(',')[0] ?? '').trim() || origin || ''
  const redirectUri = configured || (base ? `${base.replace(/\/+$/, '')}/api/auth/callback` : '')
  if (!redirectUri) return null
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    scope: env.CASDOOR_SCOPE?.trim() || 'openid profile email',
    teacherGroups: list(env.CASDOOR_TEACHER_GROUPS ?? 'teacher,教师'),
    adminGroups: list(env.CASDOOR_ADMIN_GROUPS ?? 'admin,管理员'),
  }
}

export function oidcConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getOidcConfig(env, 'https://placeholder.invalid') !== null
}

export const authorizeEndpoint = (cfg: OidcConfig) => `${cfg.issuer}/login/oauth/authorize`
export const tokenEndpoint = (cfg: OidcConfig) => `${cfg.issuer}/api/login/oauth/access_token`
export const userInfoEndpoint = (cfg: OidcConfig) => `${cfg.issuer}/api/userinfo`

// ── PKCE ──────────────────────────────────────────────────────────────────────
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}
/** S256:challenge = base64url(sha256(verifier)) */
export function codeChallengeOf(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest())
}

export interface AuthRequest {
  state: string
  nonce: string
  verifier: string
}
export function newAuthRequest(): AuthRequest {
  return { state: randomToken(16), nonce: randomToken(16), verifier: randomToken(32) }
}

export function buildAuthorizeUrl(cfg: OidcConfig, req: AuthRequest): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    state: req.state,
    nonce: req.nonce,
    code_challenge: codeChallengeOf(req.verifier),
    code_challenge_method: 'S256',
  })
  return `${authorizeEndpoint(cfg)}?${p.toString()}`
}

// ── id_token ─────────────────────────────────────────────────────────────────
export interface IdTokenClaims {
  iss?: string
  aud?: string | string[]
  sub?: string
  exp?: number
  iat?: number
  nonce?: string
  name?: string
  displayName?: string
  preferred_username?: string
  email?: string
  phone?: string
  groups?: string[] | string
  roles?: string[] | string
  [k: string]: unknown
}

/**
 * 取出 JWT 的载荷。不验签:token 是我们用 client_secret 直接从 token 端点(TLS)换来的,
 * 不是从浏览器收的(OIDC Core 3.1.3.7 允许这种情形跳过签名校验)。声明仍逐条校验。
 */
export function decodeJwtPayload(token: string): IdTokenClaims | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const obj = JSON.parse(json) as unknown
    return obj && typeof obj === 'object' ? (obj as IdTokenClaims) : null
  } catch {
    return null
  }
}

export const CLOCK_SKEW_S = 120

/** 校验 iss / aud / exp / iat / nonce;返回错误原因(不含用户信息)或 null。 */
export function validateClaims(claims: IdTokenClaims | null, cfg: OidcConfig, nonce: string, nowMs: number): string | null {
  if (!claims) return 'id_token 解析失败'
  if (!claims.sub) return 'id_token 缺少 sub'
  if (claims.iss?.replace(/\/+$/, '') !== cfg.issuer) return 'issuer 不匹配'
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (!aud.includes(cfg.clientId)) return 'audience 不匹配'
  const now = Math.floor(nowMs / 1000)
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) return 'id_token 已过期'
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) return 'id_token 签发时间在未来'
  if (claims.nonce !== nonce) return 'nonce 不匹配'
  return null
}

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []

/** 角色映射:命中 adminGroups → admin,命中 teacherGroups → teacher,其余 student。 */
export function mapRole(claims: IdTokenClaims, cfg: OidcConfig): SessionUser['role'] {
  const names = [...asList(claims.groups), ...asList(claims.roles)].map((s) => s.trim().toLowerCase())
  const hit = (list: string[]) => list.some((g) => names.includes(g.toLowerCase()))
  if (hit(cfg.adminGroups)) return 'admin'
  if (hit(cfg.teacherGroups)) return 'teacher'
  return 'student'
}

/** 会话用户:sub 前缀区分身份源,姓名取第一个可用字段(个人信息最小化,只取 sub 与姓名)。 */
export function toSessionUser(claims: IdTokenClaims, cfg: OidcConfig): SessionUser {
  const name =
    [claims.displayName, claims.name, claims.preferred_username].find((v): v is string => typeof v === 'string' && v.trim() !== '')?.trim() ?? '同学'
  return { sub: `casdoor:${claims.sub}`, name, role: mapRole(claims, cfg) }
}

// ── token 交换 ───────────────────────────────────────────────────────────────
export interface TokenResponse {
  id_token?: string
  access_token?: string
  token_type?: string
  error?: string
  error_description?: string
}

export class OidcError extends Error {}

/** 用授权码换 token(client_secret_post + PKCE verifier)。fetchImpl 便于测试注入。 */
export async function exchangeCode(
  cfg: OidcConfig,
  args: { code: string; verifier: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: args.verifier,
  })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchImpl(tokenEndpoint(cfg), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
      signal: ctrl.signal,
    })
  } catch (e) {
    throw new OidcError(e instanceof Error && e.name === 'AbortError' ? '身份服务器超时' : '连不上身份服务器')
  } finally {
    clearTimeout(timer)
  }
  let json: TokenResponse
  try {
    json = (await res.json()) as TokenResponse
  } catch {
    throw new OidcError(`身份服务器返回异常(HTTP ${res.status})`)
  }
  if (!res.ok || json.error) throw new OidcError(`换取登录凭证失败:${json.error_description ?? json.error ?? `HTTP ${res.status}`}`)
  if (!json.id_token) throw new OidcError('身份服务器没有返回 id_token(检查应用是否勾选了 OIDC / openid scope)')
  return json
}

// ── 登录失败原因 ─────────────────────────────────────────────────────────────
// 回调只往 URL 里放原因码,页面按码查表显示中文:URL 参数里的文字是外部可构造的,
// 原样显示等于在学校域名上留了个写钓鱼话术的位置。详细原因只进服务端日志。
export const LOGIN_ERRORS = {
  unconfigured: '统一身份登录还没配置，请联系管理员。',
  denied: '身份服务器拒绝了这次登录，请重试或联系管理员。',
  params: '回调参数不完整，请重新点登录。',
  state: '登录状态已失效，请重新点登录。',
  timeout: '登录超时，请重新点登录。',
  token: '没能和身份服务器换取登录凭证，请稍后再试。',
  claims: '身份服务器返回的登录凭证没通过校验，请联系管理员。',
} as const
export type LoginErrorCode = keyof typeof LOGIN_ERRORS

/** 原因码 → 中文提示;认不出的码一律落到通用文案。 */
export function loginErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null
  return LOGIN_ERRORS[code as LoginErrorCode] ?? '登录没成功，请重试。'
}

// 判断 returnTo 是否站内:交给 URL 解析器裁决,不要自己写前缀规则。
// `/\evil.com` 与 `/<TAB>/evil.com` 都能通过「以 / 开头且不以 // 开头」,
// 但浏览器与 WHATWG URL 会把它们解析成 //evil.com —— 那就是一个开放重定向。
const RETURN_TO_BASE = 'https://returnto.invalid'

/** 只接受解析后仍落在本站的相对路径,并归一化;否则返回 undefined。 */
export function safeReturnTo(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.startsWith('/')) return undefined
  try {
    const u = new URL(raw, RETURN_TO_BASE)
    if (u.origin !== RETURN_TO_BASE) return undefined
    return `${u.pathname}${u.search}${u.hash}`
  } catch {
    return undefined
  }
}

/** 登录成功后按角色决定落地页。 */
export function landingFor(role: SessionUser['role'], returnTo?: string | null): string {
  return safeReturnTo(returnTo) ?? (role === 'student' ? '/' : '/teacher')
}

// ── 登出(OIDC RP-Initiated Logout 1.0)────────────────────────────────────────
// 只清本站会话是不够的:身份服务器那边的会话还在,学生点「退出」再点「登录」,
// Casdoor 不会再问一次密码,直接把同一个人登回来 —— 在共用手机 / 机房电脑上等于没退出。
//
// 登出端点不写死。授权 / token / userinfo 三个端点是按 Casdoor 的约定拼的,但登出这个
// 没有同等稳定的承诺,而发现文档是 OIDC 的标准:向 issuer 要一次,拿 end_session_endpoint。
// 拿不到就退回「只清本地会话」—— 身份服务器不可达绝不能让人退不出来。

export const discoveryEndpoint = (cfg: OidcConfig) => `${cfg.issuer}/.well-known/openid-configuration`

/**
 * id_token 要存进会话 Cookie,登出时才能当 id_token_hint 用。会话 Cookie 有 4KB 上限,
 * 塞一个超大的 id_token 会让**登录**那一步就写不进 Cookie —— 为了登出方便把登录搞坏不划算。
 * 超限就不存:登出照常,只是少带一个 hint。
 */
export const ID_TOKEN_HINT_MAX = 2048
export function idTokenForHint(idToken: string | undefined | null): string | undefined {
  const t = idToken?.trim()
  return t && t.length <= ID_TOKEN_HINT_MAX ? t : undefined
}

/**
 * 登出端点必须与 issuer 同源。发现文档确实来自 issuer 本身(TLS),但这个地址会被我们
 * 原样 302 给学生的浏览器 —— 配错一个字就是一个挂在学校域名上的开放重定向。
 * 常见 IdP(Casdoor / Keycloak / Auth0)的登出端点都与 issuer 同源,这道门不挡正常配置。
 */
function sameOriginAsIssuer(endpoint: string, cfg: OidcConfig): boolean {
  try {
    return new URL(endpoint).origin === new URL(cfg.issuer).origin
  } catch {
    return false
  }
}

// 发现文档按 issuer 缓存在进程内。**只缓存取到的结果**:身份服务器临时抽风时不把
// 「没有登出端点」钉死一整个进程的寿命,下次登出会再试一次。
const endSessionCache = new Map<string, string>()

/** 仅供测试:清掉发现文档缓存。 */
export function resetDiscoveryCache(): void {
  endSessionCache.clear()
}

/** 取 end_session_endpoint;任何一步不顺(不可达、超时、没公布、非同源)都回 null,由上层退回本地登出。 */
export async function endSessionEndpoint(cfg: OidcConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 3_000): Promise<string | null> {
  const cached = endSessionCache.get(cfg.issuer)
  if (cached) return cached

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let doc: { end_session_endpoint?: unknown }
  try {
    const res = await fetchImpl(discoveryEndpoint(cfg), { headers: { accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) {
      console.warn(`[auth] 取发现文档失败(HTTP ${res.status}),退回本地登出`)
      return null
    }
    doc = (await res.json()) as { end_session_endpoint?: unknown }
  } catch (e) {
    console.warn(`[auth] 取发现文档失败(${e instanceof Error && e.name === 'AbortError' ? '超时' : '连不上'}),退回本地登出`)
    return null
  } finally {
    clearTimeout(timer)
  }

  const endpoint = typeof doc?.end_session_endpoint === 'string' ? doc.end_session_endpoint.trim() : ''
  if (!endpoint) {
    console.warn('[auth] 身份服务器没有公布 end_session_endpoint,退回本地登出')
    return null
  }
  if (!sameOriginAsIssuer(endpoint, cfg)) {
    console.warn('[auth] end_session_endpoint 与 issuer 不同源,不跳转,退回本地登出')
    return null
  }
  endSessionCache.set(cfg.issuer, endpoint)
  return endpoint
}

/**
 * 拼登出跳转地址。`client_id` 与 `id_token_hint` 同时带:规范允许(OP 须校验两者一致),
 * 而 `post_logout_redirect_uri` 要被采纳,OP 通常得靠其中之一认出是哪个应用。
 * 端点自带查询串时只追加、不覆盖。
 */
export function buildEndSessionUrl(endpoint: string, cfg: OidcConfig, args: { idToken?: string; postLogoutRedirectUri: string }): string {
  const url = new URL(endpoint)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('post_logout_redirect_uri', args.postLogoutRedirectUri)
  if (args.idToken) url.searchParams.set('id_token_hint', args.idToken)
  return url.toString()
}
