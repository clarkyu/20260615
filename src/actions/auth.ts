'use server'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { hashPassword, verifyPassword, fakeVerifyPassword, requireAuth } from '@/lib/auth'
import { getSession } from '@/lib/session'
import { sendVerificationEmail, sendPasswordResetEmail } from '@/lib/email'
import { getAppUrl, getSafeRedirectPath } from '@/lib/app-url'
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

// Issues a fresh email-verification token for a user and emails the link.
// Any previously-issued unused tokens are invalidated so only the latest works.
async function issueVerificationEmail(userId: number, email: string) {
  await prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } })
  const token = generateToken()
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  })
  const verifyUrl = `${await getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`
  await sendVerificationEmail(email, verifyUrl)
}

export async function register(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitRegister())) {
    return { error: 'Too many attempts. Please try again later.' }
  }

  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { error: 'Enter a valid email address' }

  const password = (formData.get('password') as string) ?? ''
  const passwordError = validatePassword(password)
  if (passwordError) return { error: passwordError }

  const { value: name, error: nameError } = validateName(formData.get('name') as string | null)
  if (nameError) return { error: nameError }

  const existing = await prisma.user.findUnique({ where: { email } })

  // An already-verified account exists — do not allow silent takeover.
  if (existing?.emailVerified) {
    return { error: 'This email is already registered. Try signing in instead.' }
  }

  const passwordHash = await hashPassword(password)
  const isAdmin = email === normalizeEmail(process.env.ADMIN_EMAIL ?? '')

  let userId: number
  if (existing) {
    // Unverified account: refresh credentials and re-send the verification email.
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, name, isAdmin },
    })
    userId = user.id
  } else {
    const user = await prisma.user.create({
      data: { email, passwordHash, name, isAdmin, emailVerified: null },
    })
    userId = user.id
  }

  try {
    await issueVerificationEmail(userId, email)
  } catch (err) {
    console.error('[register] Failed to send verification email:', err)
    return { error: 'We could not send the verification email. Please try again shortly.' }
  }

  return { success: true }
}

export async function resendVerification(prevState: unknown, formData: FormData): Promise<ActionState> {
  // Always return success to avoid revealing whether an email is registered.
  if (!(await rateLimitResend())) return { success: true }
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

// Triggered by the user clicking "Verify" on /verify-email. On success the user
// is logged in and redirected home. Using an action (not page render) keeps the
// token from being consumed by email-client link prefetchers.
export async function verifyEmail(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitVerify())) return { error: 'Too many attempts. Please try again later.' }
  const token = (formData.get('token') as string)?.trim()
  if (!token) return { error: 'This verification link is invalid.' }

  const tokenHash = hashToken(token)
  const now = new Date()

  const userId = await prisma.$transaction(async (tx) => {
    const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash } })
    if (!record || record.usedAt || record.expiresAt <= now) return null

    await Promise.all([
      tx.user.update({ where: { id: record.userId }, data: { emailVerified: now } }),
      tx.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      tx.emailVerificationToken.deleteMany({
        where: { userId: record.userId, id: { not: record.id }, usedAt: null },
      }),
    ])
    return record.userId
  })

  if (!userId) return { error: 'This verification link is invalid or has expired.' }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return { error: 'Account not found.' }

  const session = await getSession()
  session.userId = user.id
  session.email = user.email
  session.name = user.name
  session.isAdmin = user.isAdmin
  await session.save()

  redirect('/')
}

export async function login(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitLogin())) {
    return { error: 'Too many login attempts. Try again in 5 minutes.' }
  }

  const email = normalizeEmail((formData.get('email') as string) ?? '')
  const password = (formData.get('password') as string) ?? ''
  const redirectTo = getSafeRedirectPath(formData.get('redirectTo'))

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null
  if (!user) {
    // Spend the same time as a real bcrypt comparison so timing does not reveal
    // whether the email exists.
    await fakeVerifyPassword(password)
    return { error: 'Invalid email or password' }
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { error: 'Invalid email or password' }

  if (!user.emailVerified) {
    return { error: 'Please verify your email before signing in.', needsVerification: true }
  }

  const session = await getSession()
  session.userId = user.id
  session.email = user.email
  session.name = user.name
  session.isAdmin = user.isAdmin
  await session.save()

  redirect(redirectTo)
}

export async function logout() {
  const session = await getSession()
  session.destroy()
  redirect('/login')
}

export async function requestPasswordReset(prevState: unknown, formData: FormData): Promise<ActionState> {
  if (!(await rateLimitResetRequest())) return { success: true } // silent to avoid enumeration
  const email = normalizeEmail((formData.get('email') as string) ?? '')
  if (!email) return { error: 'Enter a valid email address' }

  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } })
    const token = generateToken()
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
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

  const tokenHash = hashToken(token)
  const now = new Date()

  const userId = await prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({ where: { tokenHash } })
    if (!record || record.usedAt || record.expiresAt <= now) return null

    await Promise.all([
      tx.user.update({
        where: { id: record.userId },
        // A successful reset also proves control of the inbox, so mark verified.
        data: { passwordHash: await hashPassword(password), emailVerified: now },
      }),
      tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      tx.passwordResetToken.deleteMany({
        where: { userId: record.userId, id: { not: record.id }, usedAt: null },
      }),
    ])
    return record.userId
  })

  if (!userId) return { error: 'Password reset link has expired' }
  return { success: true }
}

export async function changePassword(prevState: unknown, formData: FormData): Promise<ActionState> {
  const session = await requireAuth()
  const currentPassword = (formData.get('currentPassword') as string) ?? ''
  const newPassword = (formData.get('newPassword') as string) ?? ''
  const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

  if (!currentPassword) return { error: 'Enter your current password' }
  const passwordError = validatePassword(newPassword)
  if (passwordError) return { error: passwordError }
  if (newPassword !== confirmPassword) return { error: 'New passwords do not match' }

  const user = await prisma.user.findUnique({ where: { id: session.userId! } })
  if (!user) return { error: 'User not found' }
  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) return { error: 'Current password is incorrect' }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  })

  session.destroy()
  return { success: true }
}

export async function deleteAccount(prevState: unknown, formData: FormData): Promise<ActionState> {
  const session = await requireAuth()
  const password = (formData.get('password') as string) ?? ''
  const confirmation = (formData.get('confirmation') as string)?.trim()

  if (confirmation !== 'DELETE') return { error: 'Type DELETE to confirm account deletion' }
  const user = await prisma.user.findUnique({ where: { id: session.userId! } })
  if (!user) return { error: 'User not found' }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return { error: 'Password is incorrect' }

  await prisma.user.delete({ where: { id: user.id } })
  session.destroy()
  redirect('/register')
}
