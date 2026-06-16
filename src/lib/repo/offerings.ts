import type { PrismaClient } from '@prisma/client'

// Tenant-scoped data access for course offerings (课头：某师·某班·某学期教某课).
// All reads are scoped by school; the `?? -1` sentinel keeps a missing school
// from ever matching a row.

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.courseOffering.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}

export function findForSchoolWithCourse(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.courseOffering.findFirst({ where: { id, schoolId: schoolId ?? -1 }, include: { course: true } })
}

// Of the given classes, which already have this exact offering (course + term)?
export async function existingClassIds(
  prisma: PrismaClient,
  courseId: number,
  year: string,
  semester: string,
  classIds: number[],
): Promise<Set<number>> {
  const rows = await prisma.courseOffering.findMany({
    where: { courseId, year, semester, classId: { in: classIds } },
    select: { classId: true },
  })
  return new Set(rows.map((o) => o.classId))
}

export interface OfferingTerm {
  schoolId: number
  courseId: number
  teacherId: number
  year: string
  semester: string
}

export function createForClasses(prisma: PrismaClient, term: OfferingTerm, classIds: number[]) {
  return prisma.courseOffering.createMany({
    data: classIds.map((classId) => ({ ...term, classId })),
  })
}

export function findOne(prisma: PrismaClient, courseId: number, year: string, semester: string, classId: number) {
  return prisma.courseOffering.findFirst({ where: { courseId, year, semester, classId }, select: { id: true } })
}

export function update(
  prisma: PrismaClient,
  id: number,
  data: { courseId: number; classId: number; year: string; semester: string },
) {
  return prisma.courseOffering.update({ where: { id }, data })
}

// Delete iff it belongs to the school; returns whether a row was removed.
export async function deleteForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined): Promise<boolean> {
  const found = await prisma.courseOffering.findFirst({ where: { id, schoolId: schoolId ?? -1 }, select: { id: true } })
  if (!found) return false
  await prisma.courseOffering.delete({ where: { id } })
  return true
}
