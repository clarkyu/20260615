'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/auth'
import { hashPassword, BULK_HASH_ITERATIONS } from '@/lib/password'
import { parseRoster, type RosterRow } from '@/lib/roster'
import { getT } from '@/lib/i18n-server'

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
  const { t } = await getT()
  const buf = await readFile(formData)
  if (!buf) return { error: t('err.pickExcel') }
  const parsed = parseRoster(buf)
  if (parsed.headerError) return { error: parsed.headerError }
  return { rows: parsed.rows, validCount: parsed.validCount, errorCount: parsed.errorCount }
}

// Import: upsert classes + students scoped to the staff member's school.
// New students get initial password = 学号 and must change it on first login.
export async function commitRoster(prevState: unknown, formData: FormData): Promise<CommitState> {
  const user = await requireStaff()
  const { t } = await getT()
  if (!user.schoolId) return { error: t('err.createSchoolFirst') }
  const prisma = await getDb()
  const buf = await readFile(formData)
  if (!buf) return { error: t('err.pickExcel') }

  const parsed = parseRoster(buf)
  if (parsed.headerError) return { error: parsed.headerError }

  const schoolId = user.schoolId
  const valid = parsed.rows.filter((r) => !r.error)
  const skipped = parsed.rows.length - valid.length

  // 1) Ensure every class exists (bulk fetch + create only the missing ones).
  const classNames = [...new Set(valid.map((r) => r.className))]
  const existingClasses = await prisma.classGroup.findMany({ where: { schoolId, name: { in: classNames } } })
  const classIdByName = new Map(existingClasses.map((c) => [c.name, c.id]))
  for (const name of classNames) {
    if (classIdByName.has(name)) continue
    const rep = valid.find((r) => r.className === name)
    const c = await prisma.classGroup.create({ data: { schoolId, name, department: rep?.department, major: rep?.major } })
    classIdByName.set(name, c.id)
  }

  // 2) Which students already exist (one query).
  const existing = await prisma.user.findMany({
    where: { schoolId, role: 'STUDENT', studentNo: { in: valid.map((r) => r.studentNo) } },
    select: { id: true, studentNo: true },
  })
  const idByNo = new Map(existing.map((e) => [e.studentNo!, e.id]))
  const toCreate = valid.filter((r) => !idByNo.has(r.studentNo))
  const toUpdate = valid.filter((r) => idByNo.has(r.studentNo))

  // 3) Create new students in a single batch (lighter initial-password hash).
  let created = 0
  if (toCreate.length > 0) {
    const data = await Promise.all(
      toCreate.map(async (r) => ({
        role: 'STUDENT' as const,
        schoolId,
        classId: classIdByName.get(r.className)!,
        studentNo: r.studentNo,
        name: r.name,
        department: r.department,
        major: r.major,
        passwordHash: await hashPassword(r.studentNo, BULK_HASH_ITERATIONS),
        mustChangePassword: true,
      })),
    )
    created = (await prisma.user.createMany({ data })).count
  }

  // 4) Update existing students in one batched transaction.
  if (toUpdate.length > 0) {
    await prisma.$transaction(
      toUpdate.map((r) =>
        prisma.user.update({
          where: { id: idByNo.get(r.studentNo)! },
          data: { name: r.name, classId: classIdByName.get(r.className)!, department: r.department, major: r.major },
        }),
      ),
    )
  }

  revalidatePath('/dashboard/students')
  return { created, updated: toUpdate.length, skipped, classesTouched: classNames.length }
}
