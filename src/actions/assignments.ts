'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'

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

function readFields(formData: FormData) {
  return {
    title: (formData.get('title') as string)?.trim(),
    category: (formData.get('category') as string)?.trim() || null,
    sentences: parseSentences((formData.get('sentences') as string) ?? ''),
    monthLabel: (formData.get('monthLabel') as string)?.trim() || null,
    instructions: (formData.get('instructions') as string)?.trim() || null,
    openAt: parseDate(formData.get('openAt')),
    dueAt: parseDate(formData.get('dueAt')),
    requireEyesClosed: formData.get('requireEyesClosed') !== null,
    requireText: formData.get('requireText') !== null,
    requireAudio: formData.get('requireAudio') !== null,
    requireVideo: formData.get('requireVideo') !== null,
    requireHandwriting: formData.get('requireHandwriting') !== null,
    maxAttempts: Math.max(1, Number(formData.get('maxAttempts') ?? '1') || 1),
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

  const f = readFields(formData)
  if (!f.title) return { error: t('err.needTitle') }
  if (!f.requireText && !f.requireAudio && !f.requireVideo && !f.requireHandwriting) return { error: t('err.needSubmitKind') }

  const sentences = f.sentences.map((text, i) => ({ order: i + 1, text }))
  // One standalone create per offering. Don't wrap in $transaction: D1 has no
  // interactive transactions, so a batched create can't resolve the new
  // assignment's auto-increment id for its nested sentence inserts.
  for (const o of valid) {
    await prisma.assignment.create({
      data: {
        offeringId: o.id,
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

  const f = readFields(formData)
  if (!f.title) return { error: t('err.needTitle') }
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
