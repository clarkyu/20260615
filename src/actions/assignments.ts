'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { staffContext, staffSchoolContext } from '@/lib/action-context'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as offeringRepo from '@/lib/repo/offerings'
import {
  createAssignments,
  updateAssignment as updateAssignmentService,
  buildReviewAssignment,
  type AssignmentFields,
} from '@/lib/domain/assignments'
import { parseForm, reqText, optText, checkbox, intField, z, type ParseResult } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

function parseSentences(raw: string): string[] {
  return raw.split('\n').map((l) => l.trim()).filter(Boolean)
}

function parseDate(value: FormDataEntryValue | null): Date | null {
  const s = String(value ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

const assignmentSchema = z.object({
  title: reqText('err.needTitle', 200),
  category: optText(50),
  monthLabel: optText(20),
  instructions: optText(5000),
  requireEyesClosed: checkbox,
  requireText: checkbox,
  requireAudio: checkbox,
  requireVideo: checkbox,
  requireHandwriting: checkbox,
  maxAttempts: intField(1, 1, 99),
})

// Validate the form (zod), then assemble the DB field shape + read-aloud sentences.
function readFields(formData: FormData): ParseResult<{ fields: AssignmentFields; sentences: string[] }> {
  const parsed = parseForm(assignmentSchema, formData)
  if (!parsed.ok) return parsed
  const d = parsed.data
  return {
    ok: true,
    data: {
      fields: {
        title: d.title,
        category: d.category,
        monthLabel: d.monthLabel,
        instructions: d.instructions,
        openAt: parseDate(formData.get('openAt')),
        dueAt: parseDate(formData.get('dueAt')),
        requireEyesClosed: d.requireEyesClosed,
        requireText: d.requireText,
        requireAudio: d.requireAudio,
        requireVideo: d.requireVideo,
        requireHandwriting: d.requireHandwriting,
        maxAttempts: d.maxAttempts,
      },
      sentences: parseSentences((formData.get('sentences') as string) ?? ''),
    },
  }
}

export async function createAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const fr = readFields(formData)
  if (!fr.ok) return { error: cx.t(fr.error) }

  // The teacher may publish to several offerings (classes) of the same course.
  const offeringIds = [...new Set(formData.getAll('offeringId').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
  const chunkSetId = Number(formData.get('chunkSetId')) || null
  const primaryOfferingId = Number(formData.get('primaryOfferingId')) || null

  const res = await createAssignments(cx.prisma, cx.schoolId, fr.data.fields, fr.data.sentences, offeringIds, chunkSetId, primaryOfferingId)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath('/dashboard/teaching')
  redirect(res.redirectTo)
}

export async function updateAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const assignmentId = Number(formData.get('assignmentId'))
  const fr = readFields(formData)
  if (!fr.ok) return { error: cx.t(fr.error) }

  const res = await updateAssignmentService(cx.prisma, cx.schoolId, assignmentId, fr.data.fields, fr.data.sentences)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath(`/dashboard/assignments/${assignmentId}`)
  redirect(`/dashboard/assignments/${assignmentId}`)
}

// 学情 → 行动：把这个授课里"最弱的句子"一键生成一份复习作业，跳到编辑页让老师
// 设个截止时间再发。
export async function createReviewAssignment(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const offeringId = Number(formData.get('offeringId'))
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId)
  if (!offering) redirect('/dashboard/teaching')

  const res = await buildReviewAssignment(prisma, offeringId)
  revalidatePath(`/dashboard/teaching/${offeringId}`)
  redirect(res.redirectTo)
}

export async function deleteAssignment(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const assignmentId = Number(formData.get('assignmentId'))
  const offeringId = await assignmentRepo.deleteForSchool(prisma, assignmentId, user.schoolId)
  redirect(offeringId ? `/dashboard/teaching/${offeringId}` : '/dashboard/teaching')
}
