import type { PrismaClient } from '@prisma/client'

// Major (专业) data access. Scoped reads for the roster/class flows.

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.major.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}

// All majors in a school with their department — for the class-manager select.
export function listForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.major.findMany({
    where: { schoolId: schoolId ?? -1 },
    orderBy: { name: 'asc' },
    include: { department: { select: { name: true } } },
  })
}

// Majors with their 院系 name + the count that blocks deletion (linked 班级). Used by the
// structure-management panel so it can offer delete only on the empty (orphan) ones.
export function listWithCountsForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.major.findMany({
    where: { schoolId: schoolId ?? -1 },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, department: { select: { name: true } }, _count: { select: { classes: true } } },
  })
}

// Delete a major ONLY if it's empty (no classes) and in the actor's school. ClassGroup.majorId
// is ON DELETE SET NULL, so deleting a non-empty one would silently strip the 专业 label off
// in-use classes — the guarded where refuses that (count 0). Strictly orphan cleanup.
export function deleteEmptyForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.major.deleteMany({ where: { id, schoolId: schoolId ?? -1, classes: { none: {} } } })
}
