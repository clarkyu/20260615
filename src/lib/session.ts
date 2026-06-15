import { getIronSession, type IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import type { Role } from '@prisma/client'

export interface SessionData {
  userId?: number
  role?: Role
  name?: string | null
  // Teacher/admin
  email?: string
  // Student
  studentNo?: string | null
  schoolId?: number | null
  classId?: number | null
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
