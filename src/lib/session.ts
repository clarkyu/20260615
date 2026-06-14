import { getIronSession, type IronSession } from 'iron-session'
import { cookies } from 'next/headers'

export interface SessionData {
  userId?: number
  email?: string
  name?: string | null
  isAdmin?: boolean
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET environment variable is required')
  return getIronSession<SessionData>(await cookies(), {
    password: secret,
    cookieName: 'app-session',
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7,
    },
  })
}
