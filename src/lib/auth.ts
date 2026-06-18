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
  // The role-panel the user is currently viewing (≤ role). UI surfaces (nav/dashboard
  // scope) follow this; permission checks always use `role`.
  panelRole: Role
}

const ROLE_RANK: Record<Role, number> = { STUDENT: 0, TEACHER: 1, SCHOOL_ADMIN: 2, SUPER_ADMIN: 3 }

// A super-admin/school-admin can focus their view down to a lower-role panel ("act as
// teacher", etc.). The school-scoped panels (school-admin / teacher) require a school,
// so a school-less super-admin only ever sees the platform panel.
export function availablePanels(role: Role, schoolId: number | null | undefined): Role[] {
  if (role === 'STUDENT') return ['STUDENT']
  const out: Role[] = []
  if (role === 'SUPER_ADMIN') out.push('SUPER_ADMIN')
  if (schoolId) {
    if (ROLE_RANK['SCHOOL_ADMIN'] <= ROLE_RANK[role]) out.push('SCHOOL_ADMIN')
    if (ROLE_RANK['TEACHER'] <= ROLE_RANK[role]) out.push('TEACHER')
  }
  return out.length ? out : [role]
}

function resolvePanel(role: Role, schoolId: number | null | undefined, activeRole: Role | undefined): Role {
  if (!activeRole || activeRole === role) return role
  return availablePanels(role, schoolId).includes(activeRole) ? activeRole : role
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
    panelRole: resolvePanel(session.role, session.schoolId, session.activeRole),
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
