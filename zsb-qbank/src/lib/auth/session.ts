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
}

function options(): SessionOptions {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET 未配置或过短(需 ≥32 字符)')
  return {
    cookieName: 'zsb_session',
    password: secret,
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
  }
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options())
}
