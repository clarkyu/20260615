'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireStaff } from '@/lib/auth'

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
  if (!user.schoolId) return { error: '请先创建学校。' }

  const title = (formData.get('title') as string)?.trim()
  if (!title) return { error: '请输入作业标题' }

  const sentences = parseSentences((formData.get('sentences') as string) ?? '')
  if (sentences.length === 0) return { error: '请至少输入一句要背诵的句子（每行一句）' }

  const classIds = formData
    .getAll('classIds')
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n))
  if (classIds.length === 0) return { error: '请选择至少一个班级' }

  // Ensure every selected class belongs to this school.
  const validClasses = await prisma.classGroup.findMany({
    where: { id: { in: classIds }, schoolId: user.schoolId },
    select: { id: true },
  })
  if (validClasses.length !== classIds.length) return { error: '所选班级无效' }

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
