'use server'

import { revalidatePath } from 'next/cache'
import { schoolAdminContext } from '@/lib/action-context'
import { addTeacher as addTeacherService } from '@/lib/domain/staff'
import * as userRepo from '@/lib/repo/users'
import * as inviteRepo from '@/lib/repo/invites'
import { generateToken, hashToken } from '@/lib/tokens'
import { getAppUrl } from '@/lib/app-url'
import { parseForm, reqText, optText, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// School-admin generates a single-use, 7-day invite link a new teacher can use to
// join this school (a secure alternative to sharing the school code, which students
// also know).
export async function createSchoolInvite(): Promise<{ url?: string; error?: string }> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return { error: cx.error }
  const token = generateToken()
  await inviteRepo.create(cx.prisma, {
    tokenHash: await hashToken(token),
    schoolId: cx.schoolId,
    createdById: cx.user.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  })
  return { url: `${await getAppUrl()}/join?token=${token}` }
}

// Adds a colleague teacher to the caller's own school. The initial password equals
// the work number and must be changed on first login. This is the only in-app path
// to provision a teacher account.
export async function addTeacher(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(
    z.object({
      staffNo: reqText('err.needNoAndName', 50),
      name: reqText('err.needNoAndName', 50),
      phone: optText(50),
      email: optText(120),
    }),
    formData,
  )
  if (!parsed.ok) return { error: cx.t(parsed.error) }

  const res = await addTeacherService(cx.prisma, cx.schoolId, {
    staffNo: parsed.data.staffNo,
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email?.toLowerCase() ?? null,
  })
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath('/dashboard/teachers')
  return { success: true }
}

// Promote / demote a colleague between TEACHER and SCHOOL_ADMIN (school-admin only).
// Scoped to the caller's school; never affects a super-admin or the caller themselves.
export async function setStaffRole(formData: FormData): Promise<void> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return
  const staffId = Number(formData.get('staffId'))
  const role = String(formData.get('role'))
  if (!Number.isInteger(staffId) || staffId === cx.user.userId) return
  if (role !== 'TEACHER' && role !== 'SCHOOL_ADMIN') return
  await userRepo.setStaffRoleInSchool(cx.prisma, staffId, cx.schoolId, role)
  revalidatePath('/dashboard/teachers')
}
