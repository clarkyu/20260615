'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { staffContext, staffSchoolContext } from '@/lib/action-context'
import { hashPassword, BULK_HASH_ITERATIONS } from '@/lib/password'
import { parseRoster, type RosterRow } from '@/lib/roster'
import { importRoster } from '@/lib/domain/roster'
import * as classRepo from '@/lib/repo/classes'
import * as userRepo from '@/lib/repo/users'
import * as majorRepo from '@/lib/repo/majors'
import { parseForm, reqText, optText, reqId, z } from '@/lib/validate'

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
  const { t } = await staffContext()
  const buf = await readFile(formData)
  if (!buf) return { error: t('err.pickExcel') }
  const parsed = parseRoster(buf)
  if (parsed.headerError) return { error: t(parsed.headerError) }
  return { rows: parsed.rows, validCount: parsed.validCount, errorCount: parsed.errorCount }
}

// Import: upsert classes + students scoped to the staff member's school.
export async function commitRoster(prevState: unknown, formData: FormData): Promise<CommitState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const buf = await readFile(formData)
  if (!buf) return { error: cx.t('err.pickExcel') }

  const parsed = parseRoster(buf)
  if (parsed.headerError) return { error: cx.t(parsed.headerError) }

  const result = await importRoster(cx.prisma, cx.schoolId, parsed)
  revalidatePath('/dashboard/students')
  return result
}

// ── Class & student management ────────────────────────────────────────────────

type MutState = { error?: string; success?: boolean }

// Create an empty class by 班号 (and optional grade) without importing a roster.
export async function addClassGroup(prevState: unknown, formData: FormData): Promise<MutState> {
  const cx = await staffSchoolContext()
  if (!cx.ok) return { error: cx.error }
  const parsed = parseForm(z.object({ name: reqText('err.needClassName', 50), grade: optText(20) }), formData)
  if (!parsed.ok) return { error: cx.t(parsed.error) }
  const { name, grade } = parsed.data
  if (await classRepo.findDupName(cx.prisma, cx.schoolId, name)) return { error: cx.t('err.classNameExists') }
  await classRepo.createForSchool(cx.prisma, { schoolId: cx.schoolId, name, grade })
  revalidatePath('/dashboard/students')
  return { success: true }
}

// A select that may carry "no major": anything non-positive/blank → null (lenient).
const optMajorId = z.preprocess((v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }, z.number().int().positive().nullable())

export async function updateClass(prevState: unknown, formData: FormData): Promise<MutState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(
    z.object({ classId: reqId, name: reqText('err.needClassName', 50), grade: optText(20), majorId: optMajorId }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const { classId, name, grade, majorId } = parsed.data

  const cls = await classRepo.findClassForSchool(prisma, classId, user.schoolId)
  if (!cls) return { error: t('err.classNotFound') }
  if (await classRepo.findDupName(prisma, cls.schoolId, name, classId)) return { error: t('err.classNameExists') }
  if (majorId && !(await majorRepo.findForSchool(prisma, majorId, cls.schoolId))) return { error: t('err.classNotFound') }

  await classRepo.update(prisma, classId, { name, grade, majorId })
  revalidatePath(`/dashboard/students/${classId}`)
  revalidatePath('/dashboard/students')
  return { success: true }
}

export async function deleteClass(formData: FormData): Promise<void> {
  const { user, prisma } = await staffContext()
  const classId = Number(formData.get('classId'))
  await classRepo.deleteWithStudents(prisma, classId, user.schoolId)
  revalidatePath('/dashboard/students')
  redirect('/dashboard/students')
}

export async function addStudent(prevState: unknown, formData: FormData): Promise<MutState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(
    z.object({
      classId: reqId,
      studentNo: reqText('err.needNoAndName', 50),
      name: reqText('err.needNoAndName', 50),
      phone: optText(50),
      email: optText(120),
    }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const { classId, studentNo, name, phone } = parsed.data
  const email = parsed.data.email?.toLowerCase() ?? null

  const cls = await classRepo.findClassForSchool(prisma, classId, user.schoolId)
  if (!cls) return { error: t('err.classNotFound') }
  if (await userRepo.findStudentNoDup(prisma, cls.schoolId, studentNo)) return { error: t('err.studentNoExists') }
  if (email && (await userRepo.findEmailOwner(prisma, email))) return { error: t('err.emailTaken') }

  await userRepo.createStudent(prisma, {
    schoolId: cls.schoolId,
    classId,
    studentNo,
    name,
    phone,
    email,
    passwordHash: await hashPassword(studentNo),
  })
  revalidatePath(`/dashboard/students/${classId}`)
  return { success: true }
}

export async function updateStudent(formData: FormData): Promise<MutState> {
  const { user, prisma, t } = await staffContext()
  const parsed = parseForm(
    z.object({
      studentId: reqId,
      name: reqText('err.needNoAndName', 50),
      studentNo: reqText('err.needNoAndName', 50),
      classId: reqId,
      phone: optText(50),
      email: optText(120),
    }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const { studentId, name, studentNo, classId: newClassId, phone } = parsed.data
  const email = parsed.data.email?.toLowerCase() ?? null

  const stu = await userRepo.findStudentForSchool(prisma, studentId, user.schoolId)
  if (!stu || stu.schoolId == null) return { error: t('err.studentNotFound') }
  const cls = await classRepo.findClassForSchool(prisma, newClassId, stu.schoolId)
  if (!cls) return { error: t('err.classNotFound') }
  if (await userRepo.findStudentNoDup(prisma, stu.schoolId, studentNo, studentId)) return { error: t('err.studentNoExists') }
  if (email && (await userRepo.findEmailOwner(prisma, email, studentId))) return { error: t('err.emailTaken') }

  await userRepo.updateStudent(prisma, studentId, { name, studentNo, classId: newClassId, phone, email })
  if (stu.classId) revalidatePath(`/dashboard/students/${stu.classId}`)
  revalidatePath(`/dashboard/students/${newClassId}`)
  return { success: true }
}

export async function deleteStudent(formData: FormData): Promise<MutState> {
  const { user, prisma } = await staffContext()
  const studentId = Number(formData.get('studentId'))
  const stu = await userRepo.findStudentForSchool(prisma, studentId, user.schoolId)
  if (stu) {
    await userRepo.remove(prisma, studentId)
    if (stu.classId) revalidatePath(`/dashboard/students/${stu.classId}`)
  }
  return { success: true }
}

export async function resetStudentPassword(formData: FormData): Promise<MutState> {
  const { user, prisma, t } = await staffContext()
  const studentId = Number(formData.get('studentId'))
  const stu = await userRepo.findStudentForSchool(prisma, studentId, user.schoolId)
  if (!stu?.studentNo) return { error: t('err.studentNotFound') }
  await userRepo.setStudentPassword(prisma, studentId, await hashPassword(stu.studentNo, BULK_HASH_ITERATIONS))
  return { success: true }
}
