'use server'

import { redirect } from 'next/navigation'
import { logError } from '@/lib/log'
import { revalidatePath } from 'next/cache'
import type { PrismaClient, User } from '@prisma/client'
import { getDb } from '@/lib/db'
import { requireAuth, requireStaff } from '@/lib/auth'
import { hashPassword, verifyPassword, fakeVerifyPassword } from '@/lib/password'
import { getSession } from '@/lib/session'
import { sendVerificationEmail, sendPasswordResetEmail } from '@/lib/email'
import { emailConfigured } from '@/lib/config'
import { getAppUrl } from '@/lib/app-url'
import { normalizeEmail } from '@/lib/utils'
import { generateToken, hashToken } from '@/lib/tokens'
import { validatePassword, validateName } from '@/lib/validation'
import { getT } from '@/lib/i18n-server'
import { config } from '@/lib/config'
import * as userRepo from '@/lib/repo/users'
import * as departmentRepo from '@/lib/repo/departments'
import * as inviteRepo from '@/lib/repo/invites'
import { parseForm, optText, optId, z } from '@/lib/validate'
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

type ActionState = { error?: string; success?: boolean; needsVerification?: boolean; emailUnavailable?: boolean }

// Resolve the school from either a dropdown pick (schoolId) or a typed code.
async function resolveSchool(prisma: PrismaClient, formData: FormData) {
  const schoolId = Number(formData.get('schoolId'))
  if (Number.isInteger(schoolId) && schoolId > 0) return prisma.school.findUnique({ where: { id: schoolId } })
  const code = (formData.get('schoolCode') as string)?.trim()
  if (code) return prisma.school.findUnique({ where: { code: code.toUpperCase() } })
  return null
}

async function establishSession(user: User) {
  const session = await getSession()
  session.userId = user.id
  session.role = user.role
  session.name = user.name
  session.email = user.email ?? undefined
  session.studentNo = user.studentNo
  session.schoolId = user.schoolId
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
  const isSuperAdmin = email === normalizeEmail(config.adminEmail() ?? '')
  const role = isSuperAdmin ? 'SUPER_ADMIN' : 'TEACHER'

  // Email verification is disabled — accounts are usable immediately, so mark the
  // address verified on sign-up rather than emailing a confirmation link.
  const now = new Date()
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name, role, emailVerified: now } })
  } else {
    await prisma.user.create({ data: { email, passwordHash, name, role, emailVerified: now } })
  }
  return { success: true }
}

// Accept a school invite link: a NEW teacher sets name + email + password and is bound
// to the inviting school as TEACHER. The invite is single-use and time-limited.
export async function acceptInvite(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { t } = await getT()
  if (!(await rateLimitRegister())) return { error: t('err.tooMany') }
  const prisma = await getDb()

  const token = String(formData.get('token') ?? '')
  if (!token) return { error: t('err.inviteInvalid') }
  const invite = await inviteRepo.findValidByHash(prisma, await hashToken(token), new Date())
  if (!invite) return { error: t('err.inviteInvalid') }

  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { error: t('err.invalidEmail') }
  const passwordError = validatePassword((formData.get('password') as string) ?? '')
  if (passwordError) return { error: t(passwordError) }
  const { value: name, error: nameError } = validateName(formData.get('name') as string | null)
  if (nameError) return { error: t(nameError) }

  if (await prisma.user.findUnique({ where: { email } })) return { error: t('err.emailTaken') }

  // Consume the invite first (fenced on usedAt:null) so a replay can't create two teachers.
  const consumed = await inviteRepo.markUsed(prisma, invite.id, new Date())
  if (consumed.count === 0) return { error: t('err.inviteInvalid') }

  const passwordHash = await hashPassword((formData.get('password') as string) ?? '')
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role: 'TEACHER', schoolId: invite.schoolId, emailVerified: new Date() },
  })
  await establishSession(user)
  redirect('/dashboard')
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
      logError('resendVerification', 'failed to send verification email', err)
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

// Unified sign-in: school + 学号/工号, or email (teachers). One form for everyone.
export async function login(prevState: unknown, formData: FormData): Promise<ActionState> {
  const { t } = await getT()
  if (!(await rateLimitLogin())) return { error: t('err.tooManyLogin') }
  const prisma = await getDb()

  const password = (formData.get('password') as string) ?? ''
  const email = normalizeEmail((formData.get('email') as string) ?? '')

  let user: User | null = null
  if (email) {
    user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.role === 'STUDENT') {
      await fakeVerifyPassword(password)
      return { error: t('err.invalidCreds') }
    }
  } else {
    const identifier = (formData.get('identifier') as string)?.trim()
    const school = await resolveSchool(prisma, formData)
    if (!school || !identifier) return { error: t('err.needSchoolAndId') }
    user = await prisma.user.findFirst({
      where: { schoolId: school.id, OR: [{ studentNo: identifier }, { staffNo: identifier }] },
    })
  }

  if (!user) {
    await fakeVerifyPassword(password)
    return { error: t('err.invalidCreds') }
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { error: t('err.invalidCreds') }
  if (!user.isActive) return { error: t('err.accountDisabled') }

  await establishSession(user)
  if (user.role === 'STUDENT') redirect(user.mustChangePassword ? '/student/change-password' : '/student')
  if (user.mustChangePassword) redirect('/change-password')
  redirect('/dashboard')
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

  // If this deployment can't send email at all, say so up front. This is gated on
  // CONFIG (not on whether the account exists or a send succeeded), so the response is
  // identical for every address — it never leaks account existence. Transient send
  // failures when email IS configured stay uniformly "success" (logged server-side) to
  // preserve that anti-enumeration property.
  if (!emailConfigured()) return { success: true, emailUnavailable: true }

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
      logError('requestPasswordReset', 'failed to send reset email', err)
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

  // First-login onboarding also captures contact details. Both are optional — a
  // blank field leaves any existing value untouched (e.g. an email set at import).
  const emailInput = ((formData.get('email') as string) ?? '').trim()
  let email: string | null = null
  if (emailInput) {
    email = normalizeEmail(emailInput)
    if (!email) return { error: t('err.invalidEmail') }
    if (await userRepo.findEmailOwner(prisma, email, current.userId)) return { error: t('err.emailTaken') }
  }
  const phone = ((formData.get('phone') as string) ?? '').trim() || null

  const user = await prisma.user.findUnique({ where: { id: current.userId } })
  if (!user) return { error: t('err.userNotFound') }
  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) return { error: t('err.currentPwWrong') }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    },
  })
  const session = await getSession()
  session.destroy()
  return { success: true }
}

// A teacher sets their own 工号 (used for school + 工号 login) and department.
export async function updateStaffProfile(prevState: unknown, formData: FormData): Promise<ActionState> {
  const current = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const parsed = parseForm(z.object({ staffNo: optText(50), departmentId: optId }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const { staffNo, departmentId } = parsed.data

  if (staffNo && current.schoolId) {
    const dup = await userRepo.findStaffNoDup(prisma, current.schoolId, staffNo, current.userId)
    if (dup) return { error: t('err.staffNoExists') }
  }
  if (departmentId && current.schoolId && !(await departmentRepo.findForSchool(prisma, departmentId, current.schoolId))) {
    return { error: t('err.invalidCreds') }
  }
  await userRepo.setStaffProfile(prisma, current.userId, { staffNo, departmentId })
  revalidatePath('/profile')
  return { success: true }
}

// Any signed-in user sets their own contact details (email + phone).
export async function updateContact(prevState: unknown, formData: FormData): Promise<ActionState> {
  const current = await requireAuth()
  const { t } = await getT()
  const prisma = await getDb()
  const parsed = parseForm(z.object({ phone: optText(50), email: optText(120) }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const phone = parsed.data.phone
  const email = normalizeEmail(parsed.data.email ?? '') || null
  if (email) {
    const dup = await userRepo.findEmailOwner(prisma, email, current.userId)
    if (dup) return { error: t('err.emailTaken') }
  }
  await userRepo.setContact(prisma, current.userId, { phone, email })
  revalidatePath('/profile')
  return { success: true }
}
