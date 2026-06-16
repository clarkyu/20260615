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
