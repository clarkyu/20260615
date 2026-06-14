import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Pre-computed bcrypt hash (cost 12) with no known plaintext. Used to spend the
// same time on the login "user not found" path as a real bcrypt comparison, so
// response timing does not reveal whether an email is registered.
const DUMMY_PASSWORD_HASH = '$2b$12$cvzX0voKD1It.jFZH15qHOa9f0Qmc0naT93WrtYS80z.X8GyngDH.'

export async function fakeVerifyPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH)
}

export async function requireAuth() {
  const session = await getSession()
  if (!session.userId) redirect('/login')
  return session
}

export async function requireAdmin() {
  const session = await requireAuth()
  const user = await prisma.user.findUnique({
    where: { id: session.userId! },
    select: { isAdmin: true },
  })
  if (!user?.isAdmin) redirect('/')
  return session
}

export async function getCurrentUser() {
  const session = await getSession()
  if (!session.userId) return null
  return {
    userId: session.userId,
    email: session.email!,
    name: session.name ?? null,
    isAdmin: session.isAdmin ?? false,
  }
}
