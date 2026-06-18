import type { PrismaClient, Prisma } from '@prisma/client'

// Assignment templates: a saved publish config, reusable + editable. Visibility =
// own school + platform-global (schoolId null), mirroring the bank. Mutation
// (delete) is scoped to the actor's own school.

function visibleWhere(schoolId: number | null | undefined): Prisma.AssignmentTemplateWhereInput {
  return { OR: [{ schoolId: schoolId ?? -1 }, { schoolId: null }] }
}

// Templates a teacher can pick from — own school + global, newest first.
export function listVisible(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.assignmentTemplate.findMany({
    where: visibleWhere(schoolId),
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, schoolId: true, createdAt: true, createdBy: { select: { name: true } } },
  })
}

export function findVisible(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.assignmentTemplate.findFirst({ where: { id, ...visibleWhere(schoolId) } })
}

export function create(prisma: PrismaClient, data: { schoolId: number | null; name: string; createdById: number; payload: string }) {
  return prisma.assignmentTemplate.create({ data })
}

// Delete iff it belongs to the actor's school (global templates need a super-admin
// path, not offered here). Returns whether a row was removed.
export async function deleteForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined): Promise<boolean> {
  const found = await prisma.assignmentTemplate.findFirst({ where: { id, schoolId: schoolId ?? -1 }, select: { id: true } })
  if (!found) return false
  await prisma.assignmentTemplate.delete({ where: { id } })
  return true
}
