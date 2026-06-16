'use server'

import { revalidatePath } from 'next/cache'
import { staffSchoolContext } from '@/lib/staff-action'
import { addTeacher as addTeacherService } from '@/lib/domain/staff'
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
