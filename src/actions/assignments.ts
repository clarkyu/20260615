'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'

type ActionState = { error?: string; success?: boolean }

function parseSentences(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function parseDate(value: FormDataEntryValue | null): Date | null {
  const s = String(value ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export async function createAssignment(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const prisma = await getDb()

  const title = (formData.get('title') as string)?.trim()
  if (!title) return { error: t('err.needTitle') }

  const sentences = parseSentences((formData.get('sentences') as string) ?? '')
  if (sentences.length === 0) return { error: t('err.needSentences') }

  const classIds = formData
    .getAll('classIds')
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n))
  if (classIds.length === 0) return { error: t('err.needClass') }

  // Ensure every selected class belongs to this school.
  const validClasses = await prisma.classGroup.findMany({
    where: { id: { in: classIds }, schoolId: user.schoolId },
    select: { id: true },
  })
  if (validClasses.length !== classIds.length) return { error: t('err.invalidClass') }

  const monthLabel = (formData.get('monthLabel') as string)?.trim() || null
  const instructions = (formData.get('instructions') as string)?.trim() || null
  const openAt = parseDate(formData.get('openAt'))
  const dueAt = parseDate(formData.get('dueAt'))
  const requireEyesClosed = formData.get('requireEyesClosed') !== 'off'
  const maxAttempts = Math.max(1, Number(formData.get('maxAttempts') ?? '1') || 1)

  await prisma.assignment.create({
    data: {
      schoolId: user.schoolId,
      createdById: user.userId,
      title,
      monthLabel,
      instructions,
      openAt,
      dueAt,
      requireEyesClosed,
      maxAttempts,
      sentences: { create: sentences.map((text, i) => ({ order: i + 1, text })) },
      classes: { create: validClasses.map((c) => ({ classId: c.id })) },
    },
  })

  revalidatePath('/dashboard/assignments')
  redirect('/dashboard/assignments')
}
