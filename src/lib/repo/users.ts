import type { PrismaClient } from '@prisma/client'

// User data access shared by the staff/roster flows. (Auth flows keep their own
// queries for now — login is timing-sensitive and intentionally bespoke.)

export function findStaffByNo(prisma: PrismaClient, schoolId: number, staffNo: string) {
  return prisma.user.findFirst({ where: { schoolId, staffNo } })
}

export function findByEmail(prisma: PrismaClient, email: string) {
  return prisma.user.findFirst({ where: { email } })
}

export interface NewTeacher {
  schoolId: number
  staffNo: string
  name: string
  phone: string | null
  email: string | null
  passwordHash: string
}

// Provision a teacher who must change their password on first login.
export function createTeacher(prisma: PrismaClient, data: NewTeacher) {
  return prisma.user.create({ data: { role: 'TEACHER', mustChangePassword: true, ...data } })
}

export function setSchool(prisma: PrismaClient, userId: number, schoolId: number) {
  return prisma.user.update({ where: { id: userId }, data: { schoolId } })
}

// Founder of a school becomes its admin — bind the school AND promote to SCHOOL_ADMIN.
export function setSchoolAsAdmin(prisma: PrismaClient, userId: number, schoolId: number) {
  return prisma.user.update({ where: { id: userId }, data: { schoolId, role: 'SCHOOL_ADMIN' } })
}

// Promote/demote a colleague between TEACHER and SCHOOL_ADMIN. Scoped to the caller's
// school and to those two roles only — never touches a SUPER_ADMIN or a student.
export function setStaffRoleInSchool(prisma: PrismaClient, staffId: number, schoolId: number, role: 'TEACHER' | 'SCHOOL_ADMIN') {
  return prisma.user.updateMany({
    where: { id: staffId, schoolId, role: { in: ['TEACHER', 'SCHOOL_ADMIN'] } },
    data: { role },
  })
}

// ── student roster management ────────────────────────────────────────────────

export function findStudentForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.user.findFirst({ where: { id, role: 'STUDENT', schoolId: schoolId ?? -1 } })
}

// A student in the school with this 学号 other than `exceptId` (uniqueness check).
export function findStudentNoDup(prisma: PrismaClient, schoolId: number, studentNo: string, exceptId?: number) {
  return prisma.user.findFirst({ where: { schoolId, studentNo, role: 'STUDENT', ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
}

// Any user holding this email other than `exceptId` (emails are globally unique).
export function findEmailOwner(prisma: PrismaClient, email: string, exceptId?: number) {
  return prisma.user.findFirst({ where: { email, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
}

// A user in the school holding this 工号 other than `exceptId` (staff-no uniqueness).
export function findStaffNoDup(prisma: PrismaClient, schoolId: number, staffNo: string, exceptId?: number) {
  return prisma.user.findFirst({ where: { schoolId, staffNo, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
}

// Self-service profile edits (own row only).
export function setStaffProfile(prisma: PrismaClient, id: number, data: { staffNo: string | null; departmentId: number | null }) {
  return prisma.user.update({ where: { id }, data })
}

export function setContact(prisma: PrismaClient, id: number, data: { phone: string | null; email: string | null }) {
  return prisma.user.update({ where: { id }, data })
}

// A teacher's own default grading models.
export function gradingDefaults(prisma: PrismaClient, id: number) {
  return prisma.user.findUnique({ where: { id }, select: { defaultPerceptionModel: true, defaultJudgeModel: true } })
}

export function setGradingDefaults(prisma: PrismaClient, id: number, data: { defaultPerceptionModel: string | null; defaultJudgeModel: string | null }) {
  return prisma.user.update({ where: { id }, data })
}

export interface NewStudent {
  schoolId: number
  studentNo: string
  name: string
  phone: string | null
  email: string | null
  passwordHash: string
}

// Create a student row (without any class — membership is added separately via
// addClassMembership, the single source of truth for class membership).
export function createStudent(prisma: PrismaClient, data: NewStudent) {
  return prisma.user.create({ data: { role: 'STUDENT', mustChangePassword: true, ...data } })
}

export function updateStudent(
  prisma: PrismaClient,
  id: number,
  data: { name: string; studentNo: string; phone: string | null; email: string | null },
) {
  return prisma.user.update({ where: { id }, data })
}

export function remove(prisma: PrismaClient, id: number) {
  return prisma.user.delete({ where: { id } })
}

export function setStudentPassword(prisma: PrismaClient, id: number, passwordHash: string) {
  return prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } })
}

// ── page reads ───────────────────────────────────────────────────────────────

// The signed-in user plus their school (the dashboard/roster "do I have a school?").
export function findWithSchool(prisma: PrismaClient, id: number) {
  return prisma.user.findUnique({ where: { id }, include: { school: true } })
}

// The signed-in user with everything the profile screen shows (a student may be in
// several classes, so the profile lists them all).
export function findProfile(prisma: PrismaClient, id: number) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      school: true,
      classMemberships: {
        include: { class: { include: { major: { include: { department: { select: { name: true } } } } } } },
        orderBy: { class: { name: 'asc' } },
      },
      department: { select: { name: true } },
    },
  })
}

// Colleague teachers/admins in a school, with how many offerings each teaches.
export function listStaffForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.user.findMany({
    where: { schoolId: schoolId ?? -1, role: { in: ['TEACHER', 'SCHOOL_ADMIN'] } },
    select: { id: true, name: true, staffNo: true, email: true, role: true, _count: { select: { taughtOfferings: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

// A student belongs to a class iff they have a membership row for it.
function inClass(classId: number) {
  return { classMemberships: { some: { classId } } }
}

// Every class a student belongs to (the union of their memberships).
export async function studentClassIds(prisma: PrismaClient, studentId: number): Promise<number[]> {
  const rows = await prisma.studentClass.findMany({ where: { studentId }, select: { classId: true } })
  return rows.map((r) => r.classId)
}

// Add a class membership for a student (idempotent — all classes are equal, there
// is no special "primary").
export async function addClassMembership(prisma: PrismaClient, studentId: number, classId: number): Promise<void> {
  await prisma.studentClass.upsert({
    where: { studentId_classId: { studentId, classId } },
    create: { studentId, classId },
    update: {},
  })
}

// Remove a student from one class. If that leaves them in no class at all, delete the
// student row (a student with no class can't see or do anything). Returns nothing.
export async function removeClassMembership(prisma: PrismaClient, studentId: number, classId: number): Promise<void> {
  await prisma.studentClass.deleteMany({ where: { studentId, classId } })
  const remaining = await prisma.studentClass.count({ where: { studentId } })
  if (remaining === 0) await prisma.user.deleteMany({ where: { id: studentId, role: 'STUDENT' } })
}

// Students in one class (the class roster table).
export function listStudentsInClass(prisma: PrismaClient, classId: number) {
  return prisma.user.findMany({
    where: { role: 'STUDENT', ...inClass(classId) },
    orderBy: { studentNo: 'asc' },
    select: { id: true, studentNo: true, name: true, phone: true, email: true },
  })
}

// Lightweight roster {id, name, studentNo} for a class (school-scoped) — analytics
// + the score export (which only needs id/name/studentNo, not the full user row).
export function listClassRoster(prisma: PrismaClient, schoolId: number | null | undefined, classId: number) {
  return prisma.user.findMany({
    where: { schoolId: schoolId ?? -1, role: 'STUDENT', ...inClass(classId) },
    select: { id: true, name: true, studentNo: true },
    orderBy: { studentNo: 'asc' },
  })
}

// The signed-in user, no relations (auth gate checks: mustChangePassword).
export function findById(prisma: PrismaClient, id: number) {
  return prisma.user.findUnique({ where: { id } })
}

// 学生「看过成绩」：把 scoresSeenAt 推进到 now，清掉未读提示。
export function markScoresSeen(prisma: PrismaClient, studentId: number, at: Date) {
  return prisma.user.update({ where: { id: studentId }, data: { scoresSeenAt: at } })
}

export function scoresSeenAt(prisma: PrismaClient, studentId: number) {
  return prisma.user.findUnique({ where: { id: studentId }, select: { scoresSeenAt: true } })
}
