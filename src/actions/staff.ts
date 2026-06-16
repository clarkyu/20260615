'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getT } from '@/lib/i18n-server'
import { hashPassword, BULK_HASH_ITERATIONS } from '@/lib/password'

type ActionState = { error?: string; success?: boolean }

// Adds a colleague teacher to the caller's own school. The initial password equals
// the work number and must be changed on first login (mustChangePassword). This is
// the only in-app path to provision a teacher account.
export async function addTeacher(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }

  const staffNo = (formData.get('staffNo') as string)?.trim()
  const name = (formData.get('name') as string)?.trim()
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim().toLowerCase() || null
  if (!staffNo || !name) return { error: t('err.needNoAndName') }

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
