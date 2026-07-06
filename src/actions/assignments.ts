'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { staffContext, staffSchoolContext } from '@/lib/action-context'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as offeringRepo from '@/lib/repo/offerings'
import * as templateRepo from '@/lib/repo/templates'
import { buildTemplatePayload } from '@/lib/assignment-template'
import {
  createAssignments,
  updateAssignment as updateAssignmentService,
  buildReviewAssignment,
  mergeAssignmentBatch,
  updateAssignmentBatch,
  type AssignmentMeta,
  type PhaseDraft,
} from '@/lib/domain/assignments'
import { ASSIGNMENT_MODES } from '@/lib/assignment-mode'
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
  // 作业性质四态,空串 = 未定(存 null)。
  mode: z.enum(ASSIGNMENT_MODES).or(z.literal('')).optional().default(''),
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
  requireChoice: z.boolean().optional().default(false),
  choicesJson: z.string().nullable().optional().default(null),
  correctChoice: z.string().nullable().optional().default(null),
  multiChoice: z.boolean().optional().default(false),
  correctChoices: z.string().nullable().optional().default(null),
  fillBlank: z.boolean().optional().default(false),
  blanksJson: z.string().nullable().optional().default(null),
  requireFreeText: z.boolean().optional().default(false),
  rubric: z.string().nullable().optional().default(null),
  perceptionModel: z.string().nullable().optional().default(null),
  judgeModel: z.string().nullable().optional().default(null),
  graded: z.boolean().optional().default(true),
  maxAttempts: z.coerce.number().int().min(1).max(99).optional().default(1),
  weight: z.coerce.number().int().min(1).max(99).optional().default(1),
  isFormalTest: z.boolean().optional().default(false),
  freePractice: z.boolean().optional().default(false),
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
    requireChoice: p.requireChoice,
    choicesJson: p.choicesJson ?? null,
    correctChoice: p.correctChoice ?? null,
    multiChoice: p.multiChoice,
    correctChoices: p.correctChoices ?? null,
    fillBlank: p.fillBlank,
    blanksJson: p.blanksJson ?? null,
    requireFreeText: p.requireFreeText,
    rubric: p.rubric ?? null,
    perceptionModel: p.perceptionModel ?? null,
    judgeModel: p.judgeModel ?? null,
    graded: p.graded,
    maxAttempts: p.maxAttempts,
    weight: p.weight,
    isFormalTest: p.isFormalTest,
    freePractice: p.freePractice,
  }))
  return { ok: true, data: { meta: { title: parsed.data.title, monthLabel: parsed.data.monthLabel, mode: parsed.data.mode || null }, phases } }
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
  // Client idempotency key so a double-clicked / retried publish doesn't duplicate.
  const batchId = String(formData.get('batchId') ?? '').trim() || undefined

  const res = await createAssignments(cx.prisma, cx.schoolId, cx.user.userId, cx.user.role, fr.data.meta, fr.data.phases, offeringIds, chunkSetId, primaryOfferingId, batchId)
  if (!res.ok) return { error: cx.t(res.error) }

  // Optionally save this publish config as a reusable template (school-shared).
  const templateName = String(formData.get('templateName') ?? '').trim()
  if (formData.get('saveTemplate') && templateName) {
    const payload = buildTemplatePayload(fr.data.meta, fr.data.phases, chunkSetId)
    await templateRepo.create(cx.prisma, { schoolId: cx.schoolId, name: templateName.slice(0, 100), createdById: cx.user.userId, payload: JSON.stringify(payload) })
  }

  revalidatePath('/dashboard/teaching')
  redirect(res.redirectTo)
}

// Delete a saved template (own school). Used from the new-assignment template picker.
export async function deleteAssignmentTemplate(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const id = Number(formData.get('templateId'))
  if (Number.isInteger(id)) await templateRepo.deleteForSchool(prisma, id, user.schoolId)
  revalidatePath('/dashboard/teaching/new-assignment')
}

export async function updateAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const assignmentId = Number(formData.get('assignmentId'))
  const chunkSetId = Number(formData.get('chunkSetId')) || null
  const fr = readForm(formData)
  if (!fr.ok) return { error: cx.t(fr.error) }

  // The phase ids the form loaded — so a phase added concurrently (after load) is preserved,
  // not cascade-deleted by this (possibly stale) save. See domain.updateAssignment (audit P2-9).
  const knownPhaseIds = String(formData.get('knownPhaseIds') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
  // The assignment version the form loaded — the optimistic-lock token (0 if absent).
  const expectedVersion = Number(formData.get('version')) || 0

  const res = await updateAssignmentService(cx.prisma, cx.schoolId, cx.user.userId, cx.user.role, assignmentId, fr.data.meta, fr.data.phases, chunkSetId, knownPhaseIds, expectedVersion)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath(`/dashboard/assignments/${assignmentId}`)
  redirect(`/dashboard/assignments/${assignmentId}`)
}

// 学情 → 行动：把这个授课里"最弱的句子"一键生成一份复习作业，跳到编辑页让老师
// 设个截止时间再发。
export async function createReviewAssignment(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const offeringId = Number(formData.get('offeringId'))
  const offering = await offeringRepo.findForSchool(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) redirect('/dashboard/teaching')

  const res = await buildReviewAssignment(prisma, offeringId, user.schoolId, user.userId, user.role)
  revalidatePath(`/dashboard/teaching/${offeringId}`)
  redirect(res.redirectTo)
}

// 编辑批次:批内所有成员统一改名 + 定性质(mode 四态)。`assignmentIds` 为成员 id 逗号串。
export async function editAssignmentBatch(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(
    z.object({
      title: reqText('err.needTitle', 200),
      mode: z.enum(ASSIGNMENT_MODES).or(z.literal('')).optional().default(''),
    }),
    formData,
  )
  if (!parsed.ok) return { error: cx.t(parsed.error) }
  const assignmentIds = String(formData.get('assignmentIds') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)

  const res = await updateAssignmentBatch(cx.prisma, cx.schoolId, cx.user.userId, cx.user.role, assignmentIds, { title: parsed.data.title, mode: parsed.data.mode || null })
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath('/dashboard/assignments')
  return { success: true }
}

// 归并批次:把勾选的同课程作业合并为一个发布批次并统一标题(误分开发布的自救入口)。
// 每个 `assignmentIds` 字段携带一张卡的成员 id(逗号分隔),多张卡多个字段。
export async function mergeAssignmentBatches(prevState: unknown, formData: FormData): Promise<ActionState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(z.object({ title: reqText('err.needTitle', 200) }), formData)
  if (!parsed.ok) return { error: cx.t(parsed.error) }
  const assignmentIds = formData
    .getAll('assignmentIds')
    .flatMap((v) => String(v).split(','))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)

  const res = await mergeAssignmentBatch(cx.prisma, cx.schoolId, cx.user.userId, cx.user.role, assignmentIds, parsed.data.title)
  if (!res.ok) return { error: cx.t(res.error) }
  revalidatePath('/dashboard/assignments')
  redirect('/dashboard/assignments')
}

export async function deleteAssignment(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const assignmentId = Number(formData.get('assignmentId'))
  const offeringId = await assignmentRepo.deleteForSchool(prisma, assignmentId, user.schoolId, user.userId, user.role)
  redirect(offeringId ? `/dashboard/teaching/${offeringId}` : '/dashboard/teaching')
}
