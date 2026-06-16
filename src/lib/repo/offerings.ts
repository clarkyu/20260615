import type { PrismaClient, Role } from '@prisma/client'

// Tenant-scoped data access for course offerings (课头：某师·某班·某学期教某课).
// All reads are scoped by school; the `?? -1` sentinel keeps a missing school
// from ever matching a row.

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.courseOffering.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}

// A staff member's offerings (teacher → own; admin → whole school), newest term
// first, with course + class names — the common "pick a class to publish to" list.
export function listForStaff(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.courseOffering.findMany({
    where: { schoolId: schoolId ?? -1, ...(role === 'TEACHER' ? { teacherId: userId } : {}) },
    orderBy: [{ year: 'desc' }, { semester: 'desc' }, { id: 'desc' }],
    include: { course: { select: { name: true } }, class: { select: { name: true } } },
  })
}

// Same list with the full course + an assignment count — for the teaching index.
export function listForStaffWithCounts(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.courseOffering.findMany({
    where: { schoolId: schoolId ?? -1, ...(role === 'TEACHER' ? { teacherId: userId } : {}) },
    orderBy: [{ year: 'desc' }, { semester: 'desc' }, { id: 'desc' }],
    include: { course: true, class: { select: { name: true } }, _count: { select: { assignments: true } } },
  })
}

// One offering with its assignments (each with sentence + submission counts).
export function findDetailForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.courseOffering.findFirst({
    where: { id, schoolId: schoolId ?? -1 },
    include: {
      course: true,
      class: { select: { name: true } },
      assignments: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { sentences: true, submissions: true } } } },
    },
  })
}

// Sibling offerings = same course taught to other classes in the same term — the
// "publish to several classes at once" targets.
export function listSiblingsForStaff(
  prisma: PrismaClient,
  schoolId: number | null | undefined,
  offering: { courseId: number; year: string; semester: string },
  userId: number,
  role: Role,
) {
  return prisma.courseOffering.findMany({
    where: {
      schoolId: schoolId ?? -1,
      courseId: offering.courseId,
      year: offering.year,
      semester: offering.semester,
      ...(role === 'TEACHER' ? { teacherId: userId } : {}),
    },
    include: { class: { select: { name: true } } },
  })
}

// Of the given offering ids, those that belong to the school (publish-target check).
export async function findIdsForSchool(prisma: PrismaClient, ids: number[], schoolId: number | null | undefined): Promise<number[]> {
  const rows = await prisma.courseOffering.findMany({ where: { id: { in: ids }, schoolId: schoolId ?? -1 }, select: { id: true } })
  return rows.map((o) => o.id)
}

export function findForSchoolWithCourse(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.courseOffering.findFirst({ where: { id, schoolId: schoolId ?? -1 }, include: { course: true } })
}

// One offering with course + class (no assignments) — the analytics/gradebook header.
export function findForSchoolWithCourseClass(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.courseOffering.findFirst({
    where: { id, schoolId: schoolId ?? -1 },
    include: { course: true, class: { select: { id: true, name: true } } },
  })
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
