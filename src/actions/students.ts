'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { staffContext, schoolAdminContext } from '@/lib/action-context'
import { hashPassword, BULK_HASH_ITERATIONS } from '@/lib/password'
import { parseRoster, type RosterRow } from '@/lib/roster'
import { importRoster } from '@/lib/domain/roster'
import * as classRepo from '@/lib/repo/classes'
import * as userRepo from '@/lib/repo/users'
import * as majorRepo from '@/lib/repo/majors'
import * as departmentRepo from '@/lib/repo/departments'
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
  failed?: number
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
  const cx = await schoolAdminContext()
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
  const cx = await schoolAdminContext()
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
  const cx = await schoolAdminContext()
  if (!cx.ok) return { error: cx.error }
  const { prisma, t, schoolId } = cx
  const parsed = parseForm(
    z.object({ classId: reqId, name: reqText('err.needClassName', 50), grade: optText(20), majorId: optMajorId }),
    formData,
  )
  if (!parsed.ok) return { error: t(parsed.error) }
  const { classId, name, grade, majorId } = parsed.data

  const cls = await classRepo.findClassForSchool(prisma, classId, schoolId)
  if (!cls) return { error: t('err.classNotFound') }
  if (await classRepo.findDupName(prisma, cls.schoolId, name, classId)) return { error: t('err.classNameExists') }
  if (majorId && !(await majorRepo.findForSchool(prisma, majorId, cls.schoolId))) return { error: t('err.classNotFound') }

  await classRepo.update(prisma, classId, { name, grade, majorId })
  revalidatePath(`/dashboard/students/${classId}`)
  revalidatePath('/dashboard/students')
  return { success: true }
}

export async function deleteClass(formData: FormData): Promise<void> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return
  const classId = Number(formData.get('classId'))
  await classRepo.deleteWithStudents(cx.prisma, classId, cx.schoolId)
  revalidatePath('/dashboard/students')
  redirect('/dashboard/students')
}

// Delete an EMPTY 院系 (orphan cleanup). The repo guard only deletes when it has no majors
// and no teachers; a since-populated one is a no-op (revalidate re-renders it). Admin-only.
export async function deleteDepartment(formData: FormData): Promise<void> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return
  const id = Number(formData.get('id'))
  if (Number.isInteger(id)) await departmentRepo.deleteEmptyForSchool(cx.prisma, id, cx.schoolId)
  revalidatePath('/dashboard/students')
}

// Delete an EMPTY 专业 (orphan cleanup). The repo guard only deletes when no class uses it.
export async function deleteMajor(formData: FormData): Promise<void> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return
  const id = Number(formData.get('id'))
  if (Number.isInteger(id)) await majorRepo.deleteEmptyForSchool(cx.prisma, id, cx.schoolId)
  revalidatePath('/dashboard/students')
}

export async function addStudent(prevState: unknown, formData: FormData): Promise<MutState> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return { error: cx.error }
  const { prisma, t, schoolId } = cx
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

  const cls = await classRepo.findClassForSchool(prisma, classId, schoolId)
  if (!cls) return { error: t('err.classNotFound') }

  // A student can be in several classes: if this studentNo already exists in the
  // school, just add them to this class too instead of erroring.
  const existing = await userRepo.findStudentNoDup(prisma, cls.schoolId, studentNo)
  if (existing) {
    await userRepo.addClassMembership(prisma, existing.id, classId)
    revalidatePath(`/dashboard/students/${classId}`)
    return { success: true }
  }
  if (email && (await userRepo.findEmailOwner(prisma, email))) return { error: t('err.emailTaken') }

  const created = await userRepo.createStudent(prisma, {
    schoolId: cls.schoolId,
    studentNo,
    name,
    phone,
    email,
    passwordHash: await hashPassword(studentNo),
  })
  await userRepo.addClassMembership(prisma, created.id, classId)
  revalidatePath(`/dashboard/students/${classId}`)
  return { success: true }
}

export async function updateStudent(formData: FormData): Promise<MutState> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return { error: cx.error }
  const { prisma, t, schoolId } = cx
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
  // classId is the roster page being edited (for cache revalidation only) — editing
  // a student's details never moves their class membership.
  const { studentId, name, studentNo, classId, phone } = parsed.data
  const email = parsed.data.email?.toLowerCase() ?? null

  const stu = await userRepo.findStudentForSchool(prisma, studentId, schoolId)
  if (!stu || stu.schoolId == null) return { error: t('err.studentNotFound') }
  if (await userRepo.findStudentNoDup(prisma, stu.schoolId, studentNo, studentId)) return { error: t('err.studentNoExists') }
  if (email && (await userRepo.findEmailOwner(prisma, email, studentId))) return { error: t('err.emailTaken') }

  await userRepo.updateStudent(prisma, studentId, { name, studentNo, phone, email })
  revalidatePath(`/dashboard/students/${classId}`)
  return { success: true }
}

// Remove a student from ONE class (not the whole account). If that leaves them in no
// class at all, the student row is deleted (a classless student can't see anything).
export async function removeStudentFromClass(formData: FormData): Promise<MutState> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return { error: cx.error }
  const { prisma, t, schoolId } = cx
  const studentId = Number(formData.get('studentId'))
  const classId = Number(formData.get('classId'))
  const cls = await classRepo.findClassForSchool(prisma, classId, schoolId)
  if (!cls) return { error: t('err.classNotFound') }
  const stu = await userRepo.findStudentForSchool(prisma, studentId, schoolId)
  if (stu) {
    await userRepo.removeClassMembership(prisma, studentId, classId)
    revalidatePath(`/dashboard/students/${classId}`)
  }
  return { success: true }
}

export async function resetStudentPassword(formData: FormData): Promise<MutState> {
  const cx = await schoolAdminContext()
  if (!cx.ok) return { error: cx.error }
  const { prisma, t, schoolId } = cx
  const studentId = Number(formData.get('studentId'))
  const stu = await userRepo.findStudentForSchool(prisma, studentId, schoolId)
  if (!stu?.studentNo) return { error: t('err.studentNotFound') }
  await userRepo.setStudentPassword(prisma, studentId, await hashPassword(stu.studentNo, BULK_HASH_ITERATIONS))
  return { success: true }
}
