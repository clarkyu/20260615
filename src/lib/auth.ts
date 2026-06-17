import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import { getSession } from '@/lib/session'

export interface CurrentUser {
  userId: number
  role: Role
  name: string | null
  email?: string
  studentNo?: string | null
  schoolId?: number | null
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession()
  if (!session.userId || !session.role) return null
  return {
    userId: session.userId,
    role: session.role,
    name: session.name ?? null,
    email: session.email,
    studentNo: session.studentNo,
    schoolId: session.schoolId,
  }
}

const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']

export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireAuth()
  if (!roles.includes(user.role)) redirect(homePathForRole(user.role))
  return user
}

// Staff = anyone who manages content (teacher or admin), as opposed to students.
export async function requireStaff(): Promise<CurrentUser> {
  return requireRole(...STAFF_ROLES)
}

export function homePathForRole(role: Role): string {
  return role === 'STUDENT' ? '/student' : '/dashboard'
}
