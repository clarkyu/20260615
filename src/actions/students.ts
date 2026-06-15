'use server'

import { redirect } from 'next/navigation'
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

  // 1) Departments (院系) — create the missing ones.
  const deptNames = [...new Set(valid.map((r) => r.department).filter((v): v is string => Boolean(v)))]
  const existingDepts = await prisma.department.findMany({ where: { schoolId, name: { in: deptNames } } })
  const deptIdByName = new Map(existingDepts.map((d) => [d.name, d.id]))
  for (const name of deptNames) {
    if (deptIdByName.has(name)) continue
    const d = await prisma.department.create({ data: { schoolId, name } })
    deptIdByName.set(name, d.id)
  }

  // 2) Majors (专业) — each belongs to a department.
  const majorNames = [...new Set(valid.map((r) => r.major).filter((v): v is string => Boolean(v)))]
  const existingMajors = await prisma.major.findMany({ where: { schoolId, name: { in: majorNames } } })
  const majorIdByName = new Map(existingMajors.map((m) => [m.name, m.id]))
  for (const name of majorNames) {
    if (majorIdByName.has(name)) continue
    const rep = valid.find((r) => r.major === name && r.department)
    const departmentId = rep?.department ? deptIdByName.get(rep.department) : undefined
    if (!departmentId) continue // a major with no department — skip linking
    const m = await prisma.major.create({ data: { schoolId, departmentId, name } })
    majorIdByName.set(name, m.id)
  }

  // 3) Classes — link to a major; create the missing ones.
  const classNames = [...new Set(valid.map((r) => r.className))]
  const existingClasses = await prisma.classGroup.findMany({ where: { schoolId, name: { in: classNames } } })
  const classIdByName = new Map(existingClasses.map((c) => [c.name, c.id]))
  for (const name of classNames) {
    if (classIdByName.has(name)) continue
    const rep = valid.find((r) => r.className === name)
    const majorId = rep?.major ? majorIdByName.get(rep.major) ?? null : null
    const c = await prisma.classGroup.create({ data: { schoolId, name, majorId, grade: rep?.grade } })
    classIdByName.set(name, c.id)
  }

  // Backfill major / grade on classes missing them — only fills blanks.
  const backfills = existingClasses
    .map((c) => {
      const rep = valid.find((r) => r.className === c.name)
      const data: { majorId?: number; grade?: string } = {}
      const mId = rep?.major ? majorIdByName.get(rep.major) : undefined
      if (!c.majorId && mId) data.majorId = mId
      if (!c.grade && rep?.grade) data.grade = rep.grade
      return Object.keys(data).length ? prisma.classGroup.update({ where: { id: c.id }, data }) : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  if (backfills.length > 0) await prisma.$transaction(backfills)

  // 4) Which students already exist (one query).
  const existing = await prisma.user.findMany({
    where: { schoolId, role: 'STUDENT', studentNo: { in: valid.map((r) => r.studentNo) } },
    select: { id: true, studentNo: true },
  })
  const idByNo = new Map(existing.map((e) => [e.studentNo!, e.id]))
  const toCreate = valid.filter((r) => !idByNo.has(r.studentNo))
  const toUpdate = valid.filter((r) => idByNo.has(r.studentNo))

  // Emails are globally unique — only assign ones that are free (and de-dup within
  // the file) so a clashing email never aborts the whole import.
  const wantedEmails = [...new Set(toCreate.map((r) => r.email).filter((v): v is string => Boolean(v)))]
  const takenRows = wantedEmails.length
    ? await prisma.user.findMany({ where: { email: { in: wantedEmails } }, select: { email: true } })
    : []
  const usedEmail = new Set(takenRows.map((u) => u.email))
  const emailByNo = new Map<string, string | null>()
  for (const r of toCreate) {
    if (r.email && !usedEmail.has(r.email)) { usedEmail.add(r.email); emailByNo.set(r.studentNo, r.email) }
    else emailByNo.set(r.studentNo, null)
  }

  // 5) Create new students in a single batch (lighter initial-password hash).
  let created = 0
  if (toCreate.length > 0) {
    const data = await Promise.all(
      toCreate.map(async (r) => ({
        role: 'STUDENT' as const,
        schoolId,
        classId: classIdByName.get(r.className)!,
        studentNo: r.studentNo,
        name: r.name,
        phone: r.phone ?? null,
        email: emailByNo.get(r.studentNo) ?? null,
        passwordHash: await hashPassword(r.studentNo, BULK_HASH_ITERATIONS),
        mustChangePassword: true,
      })),
    )
    created = (await prisma.user.createMany({ data })).count
  }

  // 6) Update existing students (name / class / phone-if-provided) in one batch.
  if (toUpdate.length > 0) {
    await prisma.$transaction(
      toUpdate.map((r) =>
        prisma.user.update({
          where: { id: idByNo.get(r.studentNo)! },
          data: { name: r.name, classId: classIdByName.get(r.className)!, ...(r.phone ? { phone: r.phone } : {}) },
        }),
      ),
    )
  }

  revalidatePath('/dashboard/students')
  return { created, updated: toUpdate.length, skipped, classesTouched: classNames.length }
}

// ── Class & student management ────────────────────────────────────────────────

type MutState = { error?: string; success?: boolean }

export async function updateClass(prevState: unknown, formData: FormData): Promise<MutState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const classId = Number(formData.get('classId'))
  const name = (formData.get('name') as string)?.trim()
  const grade = (formData.get('grade') as string)?.trim() || null
  const majorIdRaw = Number(formData.get('majorId'))
  const majorId = Number.isInteger(majorIdRaw) && majorIdRaw > 0 ? majorIdRaw : null
  if (!name) return { error: t('err.needClassName') }

  const cls = await prisma.classGroup.findFirst({ where: { id: classId, schoolId: user.schoolId ?? -1 } })
  if (!cls) return { error: t('err.classNotFound') }
  const dup = await prisma.classGroup.findFirst({ where: { schoolId: cls.schoolId, name, NOT: { id: classId } } })
  if (dup) return { error: t('err.classNameExists') }
  if (majorId && !(await prisma.major.findFirst({ where: { id: majorId, schoolId: cls.schoolId } }))) {
    return { error: t('err.classNotFound') }
  }

  await prisma.classGroup.update({ where: { id: classId }, data: { name, grade, majorId } })
  revalidatePath(`/dashboard/students/${classId}`)
  revalidatePath('/dashboard/students')
  return { success: true }
}

export async function deleteClass(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const prisma = await getDb()
  const classId = Number(formData.get('classId'))
  const cls = await prisma.classGroup.findFirst({ where: { id: classId, schoolId: user.schoolId ?? -1 } })
  if (cls) {
    await prisma.user.deleteMany({ where: { classId, role: 'STUDENT' } })
    await prisma.classGroup.delete({ where: { id: classId } })
  }
  revalidatePath('/dashboard/students')
  redirect('/dashboard/students')
}

export async function addStudent(prevState: unknown, formData: FormData): Promise<MutState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const classId = Number(formData.get('classId'))
  const studentNo = (formData.get('studentNo') as string)?.trim()
  const name = (formData.get('name') as string)?.trim()
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim().toLowerCase() || null
  if (!studentNo || !name) return { error: t('err.needNoAndName') }

  const cls = await prisma.classGroup.findFirst({ where: { id: classId, schoolId: user.schoolId ?? -1 } })
  if (!cls) return { error: t('err.classNotFound') }
  const dup = await prisma.user.findFirst({ where: { schoolId: cls.schoolId, studentNo, role: 'STUDENT' } })
  if (dup) return { error: t('err.studentNoExists') }
  if (email && (await prisma.user.findFirst({ where: { email } }))) return { error: t('err.emailTaken') }

  await prisma.user.create({
    data: {
      role: 'STUDENT',
      schoolId: cls.schoolId,
      classId,
      studentNo,
      name,
      phone,
      email,
      passwordHash: await hashPassword(studentNo),
      mustChangePassword: true,
    },
  })
  revalidatePath(`/dashboard/students/${classId}`)
  return { success: true }
}

export async function updateStudent(formData: FormData): Promise<MutState> {
  const user = await requireStaff()
  const { t } = await getT()
  const prisma = await getDb()
  const studentId = Number(formData.get('studentId'))
  const name = (formData.get('name') as string)?.trim()
  const studentNo = (formData.get('studentNo') as string)?.trim()
  const newClassId = Number(formData.get('classId'))
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim().toLowerCase() || null
  if (!studentNo || !name) return { error: t('err.needNoAndName') }

  const stu = await prisma.user.findFirst({ where: { id: studentId, role: 'STUDENT', schoolId: user.schoolId ?? -1 } })
  if (!stu || stu.schoolId == null) return { error: t('err.studentNotFound') }
  const cls = await prisma.classGroup.findFirst({ where: { id: newClassId, schoolId: stu.schoolId } })
  if (!cls) return { error: t('err.classNotFound') }
  const dup = await prisma.user.findFirst({ where: { schoolId: stu.schoolId, studentNo, role: 'STUDENT', NOT: { id: studentId } } })
  if (dup) return { error: t('err.studentNoExists') }
  if (email && (await prisma.user.findFirst({ where: { email, NOT: { id: studentId } } }))) return { error: t('err.emailTaken') }

  await prisma.user.update({ where: { id: studentId }, data: { name, studentNo, classId: newClassId, phone, email } })
  if (stu.classId) revalidatePath(`/dashboard/students/${stu.classId}`)
  revalidatePath(`/dashboard/students/${newClassId}`)
  return { success: true }
}

export async function deleteStudent(formData: FormData): Promise<MutState> {
  const user = await requireStaff()
  const prisma = await getDb()
  const studentId = Number(formData.get('studentId'))
  const stu = await prisma.user.findFirst({ where: { id: studentId, role: 'STUDENT', schoolId: user.schoolId ?? -1 } })
  if (stu) {
    await prisma.user.delete({ where: { id: studentId } })
    if (stu.classId) revalidatePath(`/dashboard/students/${stu.classId}`)
  }
  return { success: true }
}

export async function resetStudentPassword(formData: FormData): Promise<MutState> {
  const user = await requireStaff()
  const prisma = await getDb()
  const studentId = Number(formData.get('studentId'))
  const stu = await prisma.user.findFirst({ where: { id: studentId, role: 'STUDENT', schoolId: user.schoolId ?? -1 } })
  if (!stu?.studentNo) return { error: 'not found' }
  await prisma.user.update({
    where: { id: studentId },
    data: { passwordHash: await hashPassword(stu.studentNo, BULK_HASH_ITERATIONS), mustChangePassword: true },
  })
  return { success: true }
}
