import { getIronSession, type IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import type { Role } from '@prisma/client'
import { config } from '@/lib/config'

export interface SessionData {
  userId?: number
  role?: Role
  name?: string | null
  // Teacher/admin
  email?: string
  // Student
  studentNo?: string | null
  schoolId?: number | null
  // Which role-panel the staff member is currently viewing (a focus preference, never
  // an escalation — always ≤ their actual role). Falls back to `role` when unset.
  activeRole?: Role
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const secret = config.sessionSecret()
  if (!secret) throw new Error('SESSION_SECRET environment variable is required')
  return getIronSession<SessionData>(await cookies(), {
    password: secret,
    cookieName: 'app-session',
    cookieOptions: {
      secure: config.isProd(),
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7,
    },
  })
}
