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
