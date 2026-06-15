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
    sentences: parseSentences((formData.get('sentences') as string) ?? ''),
    monthLabel: (formData.get('monthLabel') as string)?.trim() || null,
    instructions: (formData.get('instructions') as string)?.trim() || null,
    openAt: parseDate(formData.get('openAt')),
    dueAt: parseDate(formData.get('dueAt')),
    requireEyesClosed: formData.get('requireEyesClosed') !== null,
    maxAttempts: Math.max(1, Number(formData.get('maxAttempts') ?? '1') || 1),
  }
}

export async function createAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const prisma = await getDb()

  const offeringId = Number(formData.get('offeringId'))
  const offering = await prisma.courseOffering.findFirst({ where: { id: offeringId, schoolId: user.schoolId } })
  if (!offering) return { error: t('err.offeringNotFound') }

  const f = readFields(formData)
  if (!f.title) return { error: t('err.needTitle') }
  if (f.sentences.length === 0) return { error: t('err.needSentences') }

  await prisma.assignment.create({
    data: {
      offeringId,
      title: f.title,
      monthLabel: f.monthLabel,
      instructions: f.instructions,
      openAt: f.openAt,
      dueAt: f.dueAt,
      requireEyesClosed: f.requireEyesClosed,
      maxAttempts: f.maxAttempts,
      sentences: { create: f.sentences.map((text, i) => ({ order: i + 1, text })) },
    },
  })
  revalidatePath(`/dashboard/teaching/${offeringId}`)
  redirect(`/dashboard/teaching/${offeringId}`)
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
  if (f.sentences.length === 0) return { error: t('err.needSentences') }

  await prisma.$transaction([
    prisma.sentence.deleteMany({ where: { assignmentId } }),
    prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        title: f.title,
        monthLabel: f.monthLabel,
        instructions: f.instructions,
        openAt: f.openAt,
        dueAt: f.dueAt,
        requireEyesClosed: f.requireEyesClosed,
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
