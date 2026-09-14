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

/** 登录成功后按角色决定落地页。 */
export function landingFor(role: SessionUser['role'], returnTo?: string | null): string {
  if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) return returnTo
  return role === 'student' ? '/' : '/teacher'
}
