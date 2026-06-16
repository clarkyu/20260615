'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { hashPassword, BULK_HASH_ITERATIONS } from '@/lib/password'
import { parseForm, reqText, optText, z } from '@/lib/validate'

type ActionState = { error?: string; success?: boolean }

// Adds a colleague teacher to the caller's own school. The initial password equals
// the work number and must be changed on first login (mustChangePassword). This is
// the only in-app path to provision a teacher account.
export async function addTeacher(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }

  const parsed = parseForm(
    z.object({
      staffNo: reqText('err.needNoAndName', 50),
      name: reqText('err.needNoAndName', 50),
      phone: optText(50),
      email: optText(120),
    }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const { staffNo, name, phone } = parsed.data
  const email = parsed.data.email?.toLowerCase() ?? null

  const dup = await prisma.user.findFirst({ where: { schoolId: user.schoolId, staffNo } })
  if (dup) return { error: t('err.staffNoExists') }
  if (email && (await prisma.user.findFirst({ where: { email } }))) return { error: t('err.emailTaken') }

  await prisma.user.create({
    data: {
      role: 'TEACHER',
      schoolId: user.schoolId,
      staffNo,
      name,
      phone,
      email,
      passwordHash: await hashPassword(staffNo, BULK_HASH_ITERATIONS),
      mustChangePassword: true,
    },
  })
  revalidatePath('/dashboard/teachers')
  return { success: true }
}
