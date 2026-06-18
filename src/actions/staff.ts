'use server'

import { revalidatePath } from 'next/cache'
import { schoolAdminContext, staffSchoolContext } from '@/lib/action-context'
import { addTeacher as addTeacherService } from '@/lib/domain/staff'
import * as userRepo from '@/lib/repo/users'
import { parseForm, reqText, optText, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

// Adds a colleague teacher to the caller's own school. The initial password equals
// the work number and must be changed on first login. This is the only in-app path
// to provision a teacher account.
export async function addTeacher(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
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
