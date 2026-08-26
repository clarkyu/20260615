import { getIronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'

// 会话(iron-session + HttpOnly Cookie)。M0 只有开发登录;Casdoor OIDC 接入后
// 同一会话结构不变(docs/DECISIONS.md)。
export interface SessionUser {
  sub: string
  name: string
  role: 'student' | 'teacher' | 'admin'
}
export interface SessionData {
  user?: SessionUser
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
