'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { getSession } from '@/lib/session'

type ActionState = { error?: string; success?: boolean }

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// A staff member creates the school they belong to (sets their schoolId).
export async function createSchool(prevState: unknown, formData: FormData): Promise<ActionState> {
  const user = await requireStaff()
  const name = (formData.get('name') as string)?.trim()
  const code = normalizeCode((formData.get('code') as string) ?? '')

  if (!name) return { error: '请输入学校名称' }
  if (code.length < 3 || code.length > 12) return { error: '学校代码需为 3–12 位字母或数字' }

  const existingName = await prisma.school.findUnique({ where: { name } })
  if (existingName) return { error: '该学校名称已存在' }
  const existingCode = await prisma.school.findUnique({ where: { code } })
  if (existingCode) return { error: '该学校代码已被占用，请换一个' }

  const school = await prisma.school.create({ data: { name, code } })
  await prisma.user.update({ where: { id: user.userId }, data: { schoolId: school.id } })

  // Keep the session's schoolId in sync so subsequent pages are scoped correctly.
  const session = await getSession()
  session.schoolId = school.id
  await session.save()

  revalidatePath('/dashboard')
  return { success: true }
}
