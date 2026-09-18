import { getIronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'

// 会话(iron-session + HttpOnly Cookie)。开发登录与 Casdoor OIDC 共用同一结构:
// user 只存 sub、姓名、角色(§9.5 个人信息最小化);登录流程的一次性状态放 oidc,回调后清掉。
export interface SessionUser {
  sub: string
  name: string
  role: 'student' | 'teacher' | 'admin'
}
/** 登录流程中的一次性状态(Casdoor 授权码 + PKCE);回调用完即清。 */
export interface OidcPending {
  state: string
  nonce: string
  verifier: string
  returnTo?: string
  startedAt: number
}
export interface SessionData {
  user?: SessionUser
  oidc?: OidcPending
  /**
   * 登出时当 id_token_hint 用的原始 id_token(§9.5 的例外:它带着 email / phone 这些声明)。
   * 只进加密的 HttpOnly Cookie,不解码、不落库、不进日志,登出即随会话一起销毁;
   * 过大的不存(见 oidc.ts 的 idTokenForHint)。
   */
  idToken?: string
}

/**
 * 会话密钥是整套鉴权的根:iron-session 用它给 Cookie 加封。**密钥一旦是公开已知的,
 * 任何人都能自己封一个 `{role:'admin'}` 的 Cookie**,不需要登录、不需要按钮 ——
 * 2026-09-17 实测:抄 `.env.example` 里那行密钥就能拿到 `/api/me` 返回 admin、
 * 教师批改队列与班级接口全部 200(D84)。
 *
 * 原本只校验长度 ≥32,而出厂那句 `please-change-me-please-change-me-32` 恰好 35 字符,
 * 稳稳通过 —— 于是「安全」全靠运维照着 RUNBOOK 表格改那一行。这里把它变成一道门:
 * 占位值直接拒绝启动。宁可部署时当场报错,也不要带着公开密钥跑起来。
 */
const PLACEHOLDER_MARKERS = ['change-me', 'changeme', 'please-change', 'your-secret', 'placeholder', 'example']

/** 返回不可用的原因;可用则返回 null。纯函数,便于逐条测。 */
export function sessionSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'SESSION_SECRET 未配置'
  if (secret.length < 32) return `SESSION_SECRET 过短(${secret.length} 字符,需 ≥32)`
  const lower = secret.toLowerCase()
  const hit = PLACEHOLDER_MARKERS.find((m) => lower.includes(m))
  if (hit) {
    return `SESSION_SECRET 还是占位值(含「${hit}」)。它写在仓库的 .env.example 里、人人可见,` +
      '任何人都能用它伪造管理员会话。请生成一个真随机串:openssl rand -base64 32'
  }
  return null
}

function options(): SessionOptions {
  const secret = process.env.SESSION_SECRET
  const problem = sessionSecretProblem(secret)
  if (problem || !secret) throw new Error(problem ?? 'SESSION_SECRET 未配置') // `|| !secret` 只为让类型收窄
  return {
    cookieName: 'zsb_session',
    password: secret,
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
  }
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options())
}
