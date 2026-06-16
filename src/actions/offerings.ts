'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { staffContext, staffSchoolContext } from '@/lib/action-context'
import * as offeringRepo from '@/lib/repo/offerings'
import { createOfferings, updateOffering as updateOfferingService, type OfferingInput } from '@/lib/domain/offerings'
import { parseForm, reqText, reqId, idList, z } from '@/lib/validate'

type State = { error?: string; success?: boolean }

const courseFields = {
  courseName: reqText('err.needCourse', 100),
  courseCode: reqText('err.needCourse', 50),
  year: reqText('err.needTerm', 20),
  semester: reqText('err.needTerm', 10),
}

function toInput(d: { courseName: string; courseCode: string; year: string; semester: string }): OfferingInput {
  return { courseName: d.courseName, courseCode: d.courseCode, year: d.year, semester: d.semester }
}

export async function createOffering(prevState: unknown, formData: FormData): Promise<State> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(z.object({ ...courseFields, classId: idList }), formData)
  if (!parsed.ok) return { error: cx.t(parsed.error) }

  const res = await createOfferings(cx.prisma, cx.schoolId, cx.user.userId, toInput(parsed.data), parsed.data.classId)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath('/dashboard/teaching')
  redirect(res.redirectTo)
}

export async function updateOffering(prevState: unknown, formData: FormData): Promise<State> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(z.object({ ...courseFields, offeringId: reqId, classId: reqId }), formData)
  if (!parsed.ok) return { error: cx.t(parsed.error) }

  const res = await updateOfferingService(cx.prisma, cx.schoolId, parsed.data.offeringId, toInput(parsed.data), parsed.data.classId)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath(`/dashboard/teaching/${parsed.data.offeringId}`)
  redirect(`/dashboard/teaching/${parsed.data.offeringId}`)
}

export async function deleteOffering(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const offeringId = Number(formData.get('offeringId'))
  await offeringRepo.deleteForSchool(prisma, offeringId, user.schoolId)
  revalidatePath('/dashboard/teaching')
  redirect('/dashboard/teaching')
}
