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
import { getT } from '@/lib/i18n-server'
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

export async function register(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { t } = await getT()
  if (!(await rateLimitRegister())) return { error: t('err.tooMany') }
  const prisma = await getDb()

  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { error: t('err.invalidEmail') }

  const passwordError = validatePassword((formData.get('password') as string) ?? '')
  if (passwordError) return { error: t(passwordError) }

  const { value: name, error: nameError } = validateName(formData.get('name') as string | null)
  if (nameError) return { error: t(nameError) }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing?.emailVerified) return { error: t('err.emailTaken') }

  const passwordHash = await hashPassword((formData.get('password') as string) ?? '')
  const isSuperAdmin = email === normalizeEmail(process.env.ADMIN_EMAIL ?? '')
  const role = isSuperAdmin ? 'SUPER_ADMIN' : 'TEACHER'

  const userId = existing
    ? (await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name, role } })).id
    : (await prisma.user.create({ data: { email, passwordHash, name, role, emailVerified: null } })).id

  try {
    await issueVerificationEmail(userId, email)
  } catch (err) {
    console.error('[register] Failed to send verification email:', err)
    return { error: t('err.emailSendFail') }
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
  const { t } = await getT()
  if (!(await rateLimitVerify())) return { error: t('err.tooMany') }
  const prisma = await getDb()
  const token = (formData.get('token') as string)?.trim()
  if (!token) return { error: t('err.linkInvalid') }

  const tokenHash = await hashToken(token)
  const now = new Date()
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } })
  if (!record || record.usedAt || record.expiresAt <= now) return { error: t('err.linkExpired') }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: now } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId, id: { not: record.id }, usedAt: null } }),
  ])

  const user = await prisma.user.findUnique({ where: { id: record.userId } })
  if (!user) return { error: t('err.accountNotFound') }
  await establishSession(user)
  redirect('/dashboard')
}

export async function login(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { t } = await getT()
  if (!(await rateLimitLogin())) return { error: t('err.tooManyLogin') }
  const prisma = await getDb()

  const email = normalizeEmail((formData.get('email') as string) ?? '')
  const password = (formData.get('password') as string) ?? ''
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null
  if (!user || user.role === 'STUDENT') {
    await fakeVerifyPassword(password)
    return { error: t('err.invalidCreds') }
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { error: t('err.invalidCreds') }
  if (!user.emailVerified) return { error: t('err.needVerify'), needsVerification: true }

  await establishSession(user)
  redirect('/dashboard')
}

export async function studentLogin(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { t } = await getT()
  if (!(await rateLimitLogin())) return { error: t('err.tooManyLogin') }
  const prisma = await getDb()

  const schoolCode = (formData.get('schoolCode') as string)?.trim()
  const studentNo = (formData.get('studentNo') as string)?.trim()
  const password = (formData.get('password') as string) ?? ''
  if (!schoolCode || !studentNo) return { error: t('err.needSchoolAndId') }

  const school = await prisma.school.findUnique({ where: { code: schoolCode.toUpperCase() } })
  const user = school
    ? await prisma.user.findFirst({ where: { schoolId: school.id, studentNo, role: 'STUDENT' } })
    : null
  if (!user) {
    await fakeVerifyPassword(password)
    return { error: t('err.studentBadCreds') }
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { error: t('err.studentBadCreds') }
  if (!user.isActive) return { error: t('err.accountDisabled') }

  await establishSession(user)
  redirect(user.mustChangePassword ? '/student/change-password' : '/student')
}

export async function logout() {
  const session = await getSession()
  session.destroy()
  redirect('/login')
}

export async function requestPasswordReset(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { t } = await getT()
  if (!(await rateLimitResetRequest())) return { success: true }
  const prisma = await getDb()
  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { error: t('err.invalidEmail') }

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
  const { t } = await getT()
  const token = (formData.get('token') as string)?.trim()
  const password = (formData.get('password') as string) ?? ''
  const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

  if (!token) return { error: t('err.resetLinkMissing') }
  const passwordError = validatePassword(password)
  if (passwordError) return { error: t(passwordError) }
  if (password !== confirmPassword) return { error: t('err.pwMismatch') }
  if (!(await rateLimitResetExecute())) return { error: t('err.tooMany') }

  const prisma = await getDb()
  const tokenHash = await hashToken(token)
  const now = new Date()
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
  if (!record || record.usedAt || record.expiresAt <= now) return { error: t('err.resetExpired') }
  const newHash = await hashPassword(password)
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: newHash, emailVerified: now } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, id: { not: record.id }, usedAt: null } }),
  ])
  return { success: true }
}

export async function changePassword(prevState: unknown, formData: FormData): Promise<ActionState> {
  const current = await requireAuth()
  const { t } = await getT()
  const prisma = await getDb()
  const currentPassword = (formData.get('currentPassword') as string) ?? ''
  const newPassword = (formData.get('newPassword') as string) ?? ''
  const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

  if (!currentPassword) return { error: t('err.needCurrentPw') }
  const passwordError = validatePassword(newPassword)
  if (passwordError) return { error: t(passwordError) }
  if (newPassword !== confirmPassword) return { error: t('err.pwMismatch') }

  const user = await prisma.user.findUnique({ where: { id: current.userId } })
  if (!user) return { error: t('err.userNotFound') }
  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) return { error: t('err.currentPwWrong') }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  })
  const session = await getSession()
  session.destroy()
  return { success: true }
}
