import type { PrismaClient } from '@prisma/client'

// Department (院系) data access. Scoped reads for the profile/roster forms.

// All departments in a school as {id, name}, alphabetical.
export function listForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.department.findMany({ where: { schoolId: schoolId ?? -1 }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
}

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.department.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}

// Departments with the counts that block deletion: child 专业 + linked 教师. Used by the
// structure-management panel so it can offer delete only on the empty (orphan) ones.
export function listWithCountsForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.department.findMany({
    where: { schoolId: schoolId ?? -1 },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { majors: true, teachers: true } } },
  })
}

// Delete a department ONLY if it's empty (no majors, no teachers) and in the actor's school.
// The child FKs are ON DELETE SET NULL, so deleting a non-empty one would silently strip the
// 院系 label off in-use majors/teachers — the guarded where refuses that (count 0), so this is
// strictly orphan cleanup. Atomic: the emptiness check + delete ride one statement.
export function deleteEmptyForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.department.deleteMany({
    where: { id, schoolId: schoolId ?? -1, majors: { none: {} }, teachers: { none: {} } },
  })
}
