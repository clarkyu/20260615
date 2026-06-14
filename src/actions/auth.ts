'use server'

import { redirect } from 'next/navigation'
import type { User } from '@prisma/client'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { hashPassword, verifyPassword, fakeVerifyPassword } from '@/lib/password'
import { getSession } from '@/lib/session'
import { sendVerificationEmail, sendPasswordResetEmail } from '@/lib/email'
import { getAppUrl } from '@/lib/app-url'
import { normalizeEmail } from '@/lib/utils'
import { generateToken, hashToken } from '@/lib/tokens'
import { validatePassword, validateName } from '@/lib/validation'
import {
  rateLimitLogin,
  rateLimitRegister,
  rateLimitVerify,
  rateLimitResend,
  rateLimitResetRequest,
  rateLimitResetExecute,
} from '@/lib/rate-limit'

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TTL_MS = 60 * 60 * 1000

type ActionState = { error?: string; success?: boolean; needsVerification?: boolean }

async function establishSession(user: User) {
  const session = await getSession()
  session.userId = user.id
  session.role = user.role
  session.name = user.name
  session.email = user.email ?? undefined
  session.studentNo = user.studentNo
  session.schoolId = user.schoolId
  session.classId = user.classId
  await session.save()
}

async function issueVerificationEmail(userId: number, email: string) {
  const prisma = await getDb()
  await prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } })
  const token = generateToken()
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
  })
  const verifyUrl = `${await getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`
  await sendVerificationEmail(email, verifyUrl)
}

// Teacher / admin self sign-up (email + verification).
export async function register(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitRegister())) return { error: 'Too many attempts. Please try again later.' }
  const prisma = await getDb()

  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { error: 'Enter a valid email address' }

  const password = (formData.get('password') as string) ?? ''
  const passwordError = validatePassword(password)
  if (passwordError) return { error: passwordError }

  const { value: name, error: nameError } = validateName(formData.get('name') as string | null)
  if (nameError) return { error: nameError }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing?.emailVerified) {
    return { error: 'This email is already registered. Try signing in instead.' }
  }

  const passwordHash = await hashPassword(password)
  const isSuperAdmin = email === normalizeEmail(process.env.ADMIN_EMAIL ?? '')
  const role = isSuperAdmin ? 'SUPER_ADMIN' : 'TEACHER'

  const userId = existing
    ? (await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name, role } })).id
    : (await prisma.user.create({ data: { email, passwordHash, name, role, emailVerified: null } })).id

  try {
    await issueVerificationEmail(userId, email)
  } catch (err) {
    console.error('[register] Failed to send verification email:', err)
    return { error: 'We could not send the verification email. Please try again shortly.' }
  }
  return { success: true }
}

export async function resendVerification(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitResend())) return { success: true }
  const prisma = await getDb()
  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { success: true }
  const user = await prisma.user.findUnique({ where: { email } })
  if (user && !user.emailVerified) {
    try {
      await issueVerificationEmail(user.id, email)
    } catch (err) {
      console.error('[resendVerification] Failed to send verification email:', err)
    }
  }
  return { success: true }
}

export async function verifyEmail(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitVerify())) return { error: 'Too many attempts. Please try again later.' }
  const prisma = await getDb()
  const token = (formData.get('token') as string)?.trim()
  if (!token) return { error: 'This verification link is invalid.' }

  const tokenHash = await hashToken(token)
  const now = new Date()

  // D1 has no interactive transactions: read+validate first, then a batched
  // ($transaction array) write.
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } })
  if (!record || record.usedAt || record.expiresAt <= now) {
    return { error: 'This verification link is invalid or has expired.' }
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: now } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId, id: { not: record.id }, usedAt: null } }),
  ])

  const user = await prisma.user.findUnique({ where: { id: record.userId } })
  if (!user) return { error: 'Account not found.' }
  await establishSession(user)
  redirect('/dashboard')
}

// Teacher / admin login (email).
export async function login(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitLogin())) return { error: 'Too many login attempts. Try again in 5 minutes.' }
  const prisma = await getDb()

  const email = normalizeEmail((formData.get('email') as string) ?? '')
  const password = (formData.get('password') as string) ?? ''

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null
  if (!user || user.role === 'STUDENT') {
    await fakeVerifyPassword(password)
    return { error: 'Invalid email or password' }
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { error: 'Invalid email or password' }
  if (!user.emailVerified) return { error: 'Please verify your email before signing in.', needsVerification: true }

  await establishSession(user)
  redirect('/dashboard')
}

// Student login (school code + 学号 + password). No email required.
export async function studentLogin(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitLogin())) return { error: '尝试过于频繁，请 5 分钟后再试。' }
  const prisma = await getDb()

  const schoolCode = (formData.get('schoolCode') as string)?.trim()
  const studentNo = (formData.get('studentNo') as string)?.trim()
  const password = (formData.get('password') as string) ?? ''
  if (!schoolCode || !studentNo) return { error: '请输入学校代码和学号' }

  const school = await prisma.school.findUnique({ where: { code: schoolCode } })
  const user = school
    ? await prisma.user.findFirst({ where: { schoolId: school.id, studentNo, role: 'STUDENT' } })
    : null

  if (!user) {
    await fakeVerifyPassword(password)
    return { error: '学校代码、学号或密码不正确' }
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { error: '学校代码、学号或密码不正确' }
  if (!user.isActive) return { error: '账号已停用，请联系老师。' }

  await establishSession(user)
  redirect(user.mustChangePassword ? '/student/change-password' : '/student')
}

export async function logout() {
  const session = await getSession()
  session.destroy()
  redirect('/login')
}

export async function requestPasswordReset(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitResetRequest())) return { success: true }
  const prisma = await getDb()
  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { error: 'Enter a valid email address' }

  const user = await prisma.user.findUnique({ where: { email } })
  if (user && user.email) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } })
    const token = generateToken()
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    })
    const resetUrl = `${await getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`
    try {
      await sendPasswordResetEmail(user.email, resetUrl)
    } catch (err) {
      console.error('[requestPasswordReset] Failed to send reset email:', err)
    }
  }
  return { success: true }
}

export async function resetPassword(prevState: unknown, formData: FormData): Promise<ActionState> {
  const token = (formData.get('token') as string)?.trim()
  const password = (formData.get('password') as string) ?? ''
  const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

  if (!token) return { error: 'Password reset link is missing or invalid' }
  const passwordError = validatePassword(password)
  if (passwordError) return { error: passwordError }
  if (password !== confirmPassword) return { error: 'Passwords do not match' }
  if (!(await rateLimitResetExecute())) return { error: 'Too many attempts. Try again later.' }

  const prisma = await getDb()
  const tokenHash = await hashToken(token)
  const now = new Date()

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
  if (!record || record.usedAt || record.expiresAt <= now) {
    return { error: 'Password reset link has expired' }
  }
  const newHash = await hashPassword(password)
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: newHash, emailVerified: now } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, id: { not: record.id }, usedAt: null } }),
  ])
  return { success: true }
}

// Works for any signed-in user; clears the forced-change flag (student first login).
export async function changePassword(prevState: unknown, formData: FormData): Promise<ActionState> {
  const current = await requireAuth()
  const prisma = await getDb()
  const currentPassword = (formData.get('currentPassword') as string) ?? ''
  const newPassword = (formData.get('newPassword') as string) ?? ''
  const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

  if (!currentPassword) return { error: '请输入当前密码' }
  const passwordError = validatePassword(newPassword)
  if (passwordError) return { error: passwordError }
  if (newPassword !== confirmPassword) return { error: '两次输入的新密码不一致' }

  const user = await prisma.user.findUnique({ where: { id: current.userId } })
  if (!user) return { error: '用户不存在' }
  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) return { error: '当前密码不正确' }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  })
  const session = await getSession()
  session.destroy()
  return { success: true }
}
