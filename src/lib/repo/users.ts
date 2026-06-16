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

export interface NewStudent {
  schoolId: number
  classId: number
  studentNo: string
  name: string
  phone: string | null
  email: string | null
  passwordHash: string
}

export function createStudent(prisma: PrismaClient, data: NewStudent) {
  return prisma.user.create({ data: { role: 'STUDENT', mustChangePassword: true, ...data } })
}

export function updateStudent(
  prisma: PrismaClient,
  id: number,
  data: { name: string; studentNo: string; classId: number; phone: string | null; email: string | null },
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

// The signed-in user with everything the profile screen shows.
export function findProfile(prisma: PrismaClient, id: number) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      school: true,
      class: { include: { major: { include: { department: { select: { name: true } } } } } },
      department: { select: { name: true } },
    },
  })
}

// Colleague teachers/admins in a school, with how many offerings each teaches.
export function listStaffForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.user.findMany({
    where: { schoolId: schoolId ?? -1, role: { in: ['TEACHER', 'SCHOOL_ADMIN'] } },
    select: { id: true, name: true, staffNo: true, email: true, _count: { select: { taughtOfferings: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

// Students in one class (the class roster table).
export function listStudentsInClass(prisma: PrismaClient, classId: number) {
  return prisma.user.findMany({
    where: { classId, role: 'STUDENT' },
    orderBy: { studentNo: 'asc' },
    select: { id: true, studentNo: true, name: true, phone: true, email: true },
  })
}
