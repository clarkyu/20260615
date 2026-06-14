'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { hashPassword } from '@/lib/password'
import { parseRoster, type RosterRow } from '@/lib/roster'

type PreviewState = {
  error?: string
  rows?: RosterRow[]
  validCount?: number
  errorCount?: number
}

type CommitState = {
  error?: string
  created?: number
  updated?: number
  skipped?: number
  classesTouched?: number
}

async function readFile(formData: FormData): Promise<ArrayBuffer | null> {
  const file = formData.get('file')
  if (!file || typeof file === 'string') return null
  return file.arrayBuffer()
}

export async function previewRoster(prevState: unknown, formData: FormData): Promise<PreviewState> {
  await requireStaff()
  const buf = await readFile(formData)
  if (!buf) return { error: '请选择 Excel 文件（.xlsx）' }
  const parsed = await parseRoster(buf)
  if (parsed.headerError) return { error: parsed.headerError }
  return { rows: parsed.rows, validCount: parsed.validCount, errorCount: parsed.errorCount }
}

// Import: upsert classes + students scoped to the staff member's school.
// New students get initial password = 学号 and must change it on first login.
export async function commitRoster(prevState: unknown, formData: FormData): Promise<CommitState> {
  const user = await requireStaff()
  if (!user.schoolId) return { error: '请先创建学校，再导入名单。' }
  const prisma = await getDb()
  const buf = await readFile(formData)
  if (!buf) return { error: '请选择 Excel 文件（.xlsx）' }

  const parsed = await parseRoster(buf)
  if (parsed.headerError) return { error: parsed.headerError }

  const schoolId = user.schoolId
  let created = 0
  let updated = 0
  let skipped = 0
  const classIds = new Set<number>()

  for (const row of parsed.rows) {
    if (row.error) {
      skipped++
      continue
    }
    const cls = await prisma.classGroup.upsert({
      where: { schoolId_name: { schoolId, name: row.className } },
      update: { department: row.department, major: row.major },
      create: { schoolId, name: row.className, department: row.department, major: row.major },
    })
    classIds.add(cls.id)

    const existing = await prisma.user.findFirst({
      where: { schoolId, studentNo: row.studentNo, role: 'STUDENT' },
    })
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: row.name, classId: cls.id, department: row.department, major: row.major },
      })
      updated++
    } else {
      await prisma.user.create({
        data: {
          role: 'STUDENT',
          schoolId,
          classId: cls.id,
          studentNo: row.studentNo,
          name: row.name,
          department: row.department,
          major: row.major,
          passwordHash: await hashPassword(row.studentNo),
          mustChangePassword: true,
        },
      })
      created++
    }
  }

  revalidatePath('/dashboard/students')
  return { created, updated, skipped, classesTouched: classIds.size }
}
