'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getSession } from '@/lib/session'
import { getT } from '@/lib/i18n-server'
import { parseForm, reqText, optText, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function createSchool(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const parsed = parseForm(z.object({ name: reqText('err.needSchoolName', 100), code: optText(20) }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const name = parsed.data.name
  const code = normalizeCode(parsed.data.code ?? '')
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
  const parsed = parseForm(z.object({ name: reqText('err.needSchoolName', 100) }), formData)
  if (!parsed.ok) return { error: t(parsed.error) }
  const name = parsed.data.name

  const dup = await prisma.school.findFirst({ where: { name, NOT: { id: user.schoolId } } })
  if (dup) return { error: t('err.schoolNameExists') }

  await prisma.school.update({ where: { id: user.schoolId }, data: { name } })
  revalidatePath('/profile')
  revalidatePath('/dashboard')
  return { success: true }
}
