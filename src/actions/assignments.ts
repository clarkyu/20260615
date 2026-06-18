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
  type AssignmentMeta,
  type PhaseDraft,
} from '@/lib/domain/assignments'
import { parseForm, reqText, optText, z, type ParseResult } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

function parseSentences(raw: string): string[] {
  return raw.split('\n').map((l) => l.trim()).filter(Boolean)
}

function parseDate(value: string | null | undefined): Date | null {
  const s = String(value ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// Assignment-level (shared) fields. Each phase's content/requirements/window arrive
// as a JSON array in the hidden `phasesJson` field (a dynamic list the form edits).
const metaSchema = z.object({
  title: reqText('err.needTitle', 200),
  monthLabel: optText(20),
})

const phaseJsonSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  title: z.string().max(200).optional().default(''),
  category: z.string().max(50).optional().default(''),
  instructions: z.string().max(5000).optional().default(''),
  useBankSet: z.boolean().optional().default(false),
  sentences: z.string().max(20000).optional().default(''),
  openAt: z.string().optional().default(''),
  dueAt: z.string().optional().default(''),
  requireEyesClosed: z.boolean().optional().default(false),
  requireText: z.boolean().optional().default(false),
  requireAudio: z.boolean().optional().default(false),
  requireVideo: z.boolean().optional().default(false),
  requireHandwriting: z.boolean().optional().default(false),
  graded: z.boolean().optional().default(true),
  maxAttempts: z.coerce.number().int().min(1).max(99).optional().default(1),
})
const phasesJsonSchema = z.array(phaseJsonSchema).min(1).max(20)

// Validate the form (zod) → assignment meta + the parsed phase drafts.
function readForm(formData: FormData): ParseResult<{ meta: AssignmentMeta; phases: PhaseDraft[] }> {
  const parsed = parseForm(metaSchema, formData)
  if (!parsed.ok) return parsed

  let raw: unknown
  try { raw = JSON.parse(String(formData.get('phasesJson') ?? '')) } catch { return { ok: false, error: 'err.needPhase' } }
  const pr = phasesJsonSchema.safeParse(raw)
  if (!pr.success) return { ok: false, error: 'err.needPhase' }

  const phases: PhaseDraft[] = pr.data.map((p) => ({
    id: p.id ?? null,
    title: p.title.trim() || null,
    category: p.category.trim() || null,
    instructions: p.instructions.trim() || null,
    useBankSet: p.useBankSet,
    typedSentences: parseSentences(p.sentences),
    openAt: parseDate(p.openAt),
    dueAt: parseDate(p.dueAt),
    requireEyesClosed: p.requireEyesClosed,
    requireText: p.requireText,
    requireAudio: p.requireAudio,
    requireVideo: p.requireVideo,
    requireHandwriting: p.requireHandwriting,
    graded: p.graded,
    maxAttempts: p.maxAttempts,
  }))
  return { ok: true, data: { meta: { title: parsed.data.title, monthLabel: parsed.data.monthLabel }, phases } }
}

export async function createAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const fr = readForm(formData)
  if (!fr.ok) return { error: cx.t(fr.error) }

  // The teacher may publish to several offerings (classes) of the same course.
  const offeringIds = [...new Set(formData.getAll('offeringId').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
  const chunkSetId = Number(formData.get('chunkSetId')) || null
  const primaryOfferingId = Number(formData.get('primaryOfferingId')) || null

  const res = await createAssignments(cx.prisma, cx.schoolId, fr.data.meta, fr.data.phases, offeringIds, chunkSetId, primaryOfferingId)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath('/dashboard/teaching')
  redirect(res.redirectTo)
}

export async function updateAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const assignmentId = Number(formData.get('assignmentId'))
  const chunkSetId = Number(formData.get('chunkSetId')) || null
  const fr = readForm(formData)
  if (!fr.ok) return { error: cx.t(fr.error) }

  const res = await updateAssignmentService(cx.prisma, cx.schoolId, assignmentId, fr.data.meta, fr.data.phases, chunkSetId)
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
