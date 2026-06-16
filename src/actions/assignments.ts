'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { weakSentences, parsePerSentence, type AnalyticsSubmission } from '@/lib/domain/analytics'
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

type AssignmentFields = z.infer<typeof assignmentSchema> & {
  sentences: string[]
  openAt: Date | null
  dueAt: Date | null
}

// Validate the form fields (zod), then add the derived sentences + dates.
function readFields(formData: FormData): ParseResult<AssignmentFields> {
  const parsed = parseForm(assignmentSchema, formData)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    data: {
      ...parsed.data,
      sentences: parseSentences((formData.get('sentences') as string) ?? ''),
      openAt: parseDate(formData.get('openAt')),
      dueAt: parseDate(formData.get('dueAt')),
    },
  }
}

export async function createAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const schoolId = user.schoolId
  const prisma = await getDb()

  // One assignment per selected offering — the teacher may publish to several
  // classes (offerings) of the same course at once.
  const offeringIds = [...new Set(formData.getAll('offeringId').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
  if (offeringIds.length === 0) return { error: t('err.needPublishTarget') }
  const valid = await prisma.courseOffering.findMany({ where: { id: { in: offeringIds }, schoolId }, select: { id: true } })
  if (valid.length === 0) return { error: t('err.offeringNotFound') }

  const fr = readFields(formData)
  if (!fr.ok) return { error: t(fr.error) }
  const f = fr.data
  if (!f.requireText && !f.requireAudio && !f.requireVideo && !f.requireHandwriting) return { error: t('err.needSubmitKind') }

  // Publishing from the item bank: pull the shadow video + sentences from the set.
  let shadowVideoKey: string | null = null
  let linkedSetId: number | null = null
  let sentences = f.sentences.map((text, i) => ({ order: i + 1, text, translation: null as string | null }))
  const chunkSetId = Number(formData.get('chunkSetId')) || null
  if (chunkSetId) {
    const set = await prisma.chunkSet.findFirst({
      where: { id: chunkSetId, schoolId },
      include: { chunks: { orderBy: { order: 'asc' } } },
    })
    if (!set) return { error: t('err.setNotFound') }
    shadowVideoKey = set.shadowVideoKey
    linkedSetId = set.id
    // The example sentence is what the student reads aloud / shadows.
    sentences = set.chunks.map((c, i) => ({ order: i + 1, text: c.exampleEn || c.english, translation: c.exampleZh || c.chinese }))
  }

  // One standalone create per offering. Don't wrap in $transaction: D1 has no
  // interactive transactions, so a batched create can't resolve the new
  // assignment's auto-increment id for its nested sentence inserts.
  for (const o of valid) {
    await prisma.assignment.create({
      data: {
        offeringId: o.id,
        title: f.title,
        category: f.category,
        shadowVideoKey,
        chunkSetId: linkedSetId,
        monthLabel: f.monthLabel,
        instructions: f.instructions,
        openAt: f.openAt,
        dueAt: f.dueAt,
        requireEyesClosed: f.requireEyesClosed,
        requireText: f.requireText,
        requireAudio: f.requireAudio,
        requireVideo: f.requireVideo,
        requireHandwriting: f.requireHandwriting,
        maxAttempts: f.maxAttempts,
        sentences: { create: sentences },
      },
    })
  }
  revalidatePath('/dashboard/teaching')

  // Return to the offering the teacher started from, if it was among the targets.
  const primary = Number(formData.get('primaryOfferingId'))
  const target = valid.some((o) => o.id === primary) ? primary : valid[0].id
  redirect(`/dashboard/teaching/${target}`)
}

export async function updateAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const prisma = await getDb()

  const assignmentId = Number(formData.get('assignmentId'))
  const existing = await prisma.assignment.findFirst({ where: { id: assignmentId, offering: { schoolId: user.schoolId } } })
  if (!existing) return { error: t('err.assignNotFound') }

  const fr = readFields(formData)
  if (!fr.ok) return { error: t(fr.error) }
  const f = fr.data
  if (!f.requireText && !f.requireAudio && !f.requireVideo && !f.requireHandwriting) return { error: t('err.needSubmitKind') }

  await prisma.$transaction([
    prisma.sentence.deleteMany({ where: { assignmentId } }),
    prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        title: f.title,
        category: f.category,
        monthLabel: f.monthLabel,
        instructions: f.instructions,
        openAt: f.openAt,
        dueAt: f.dueAt,
        requireEyesClosed: f.requireEyesClosed,
        requireText: f.requireText,
        requireAudio: f.requireAudio,
        requireVideo: f.requireVideo,
        requireHandwriting: f.requireHandwriting,
        maxAttempts: f.maxAttempts,
        sentences: { create: f.sentences.map((text, i) => ({ order: i + 1, text })) },
      },
    }),
  ])
  revalidatePath(`/dashboard/assignments/${assignmentId}`)
  redirect(`/dashboard/assignments/${assignmentId}`)
}

// 学情 → 行动：把这个授课里"最弱的句子"一键生成一份复习作业（默认音频背诵、
// 可多次），创建后跳到编辑页让老师设个截止时间再发。
export async function createReviewAssignment(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const prisma = await getDb()
  const offeringId = Number(formData.get('offeringId'))
  const offering = await prisma.courseOffering.findFirst({ where: { id: offeringId, schoolId: user.schoolId ?? -1 } })
  if (!offering) redirect('/dashboard/teaching')

  const assignments = await prisma.assignment.findMany({
    where: { offeringId },
    select: { id: true, sentences: { select: { order: true, text: true, translation: true } } },
  })
  const textByKey = new Map<string, { text: string; translation: string | null }>()
  for (const a of assignments) for (const s of a.sentences) textByKey.set(`${a.id}:${s.order}`, { text: s.text, translation: s.translation })

  const rawSubs = await prisma.submission.findMany({
    where: { assignment: { offeringId } },
    select: { studentId: true, assignmentId: true, status: true, finalScore: true, needsReview: true, aiResult: true },
    orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { attempt: 'desc' }],
  })
  const seen = new Set<string>()
  const subs: AnalyticsSubmission[] = []
  for (const s of rawSubs) {
    const k = `${s.studentId}:${s.assignmentId}`
    if (seen.has(k)) continue
    seen.add(k)
    subs.push({ studentId: s.studentId, assignmentId: s.assignmentId, status: s.status, finalScore: s.finalScore, needsReview: s.needsReview, perSentence: parsePerSentence(s.aiResult) })
  }

  const picked: { text: string; translation: string | null }[] = []
  const used = new Set<string>()
  for (const w of weakSentences(subs, 12)) {
    const e = textByKey.get(`${w.assignmentId}:${w.order}`)
    if (e && !used.has(e.text)) { used.add(e.text); picked.push(e) }
  }
  if (picked.length === 0) redirect(`/dashboard/teaching/${offeringId}/insights`)

  const d = new Date()
  const created = await prisma.assignment.create({
    data: {
      offeringId,
      title: `复习 · 薄弱句 ${d.getMonth() + 1}-${d.getDate()}`,
      category: '复习作业',
      requireAudio: true,
      requireVideo: false,
      requireText: false,
      requireEyesClosed: false,
      requireHandwriting: false,
      maxAttempts: 3,
      sentences: { create: picked.map((p, i) => ({ order: i + 1, text: p.text, translation: p.translation })) },
    },
  })
  revalidatePath(`/dashboard/teaching/${offeringId}`)
  redirect(`/dashboard/assignments/${created.id}/edit`)
}

export async function deleteAssignment(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const prisma = await getDb()
  const assignmentId = Number(formData.get('assignmentId'))
  const existing = await prisma.assignment.findFirst({
    where: { id: assignmentId, offering: { schoolId: user.schoolId ?? -1 } },
    select: { offeringId: true },
  })
  if (existing) await prisma.assignment.delete({ where: { id: assignmentId } })
  redirect(existing ? `/dashboard/teaching/${existing.offeringId}` : '/dashboard/teaching')
}
