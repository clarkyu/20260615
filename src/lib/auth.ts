import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import { getSession } from '@/lib/session'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Pre-computed bcrypt hash (cost 12) with no known plaintext. Spends the same
// time on the "user not found" path as a real comparison so login timing does
// not reveal whether an account exists.
const DUMMY_PASSWORD_HASH = '$2b$12$cvzX0voKD1It.jFZH15qHOa9f0Qmc0naT93WrtYS80z.X8GyngDH.'

export async function fakeVerifyPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH)
}

export interface CurrentUser {
  userId: number
  role: Role
  name: string | null
  email?: string
  studentNo?: string | null
  schoolId?: number | null
  classId?: number | null
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
    classId: session.classId,
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
