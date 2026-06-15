'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getSession } from '@/lib/session'
import { getT } from '@/lib/i18n-server'

type ActionState = { error?: string; success?: boolean }

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function createSchool(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const name = (formData.get('name') as string)?.trim()
  const code = normalizeCode((formData.get('code') as string) ?? '')

  if (!name) return { error: t('err.needSchoolName') }
  if (code.length < 3 || code.length > 12) return { error: t('err.codeFormat') }

  if (await prisma.school.findUnique({ where: { name } })) return { error: t('err.schoolNameExists') }
  if (await prisma.school.findUnique({ where: { code } })) return { error: t('err.codeTaken') }

  const school = await prisma.school.create({ data: { name, code } })
  await prisma.user.update({ where: { id: user.userId }, data: { schoolId: school.id } })

  const session = await getSession()
  session.schoolId = school.id
  await session.save()

  revalidatePath('/dashboard')
  return { success: true }
}

// Rename the staff member's school (the code is kept).
export async function renameSchool(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const name = (formData.get('name') as string)?.trim()
  if (!name) return { error: t('err.needSchoolName') }

  const dup = await prisma.school.findFirst({ where: { name, NOT: { id: user.schoolId } } })
  if (dup) return { error: t('err.schoolNameExists') }

  await prisma.school.update({ where: { id: user.schoolId }, data: { name } })
  revalidatePath('/profile')
  revalidatePath('/dashboard')
  return { success: true }
}
