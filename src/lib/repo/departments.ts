import type { PrismaClient } from '@prisma/client'

// Department (院系) data access. Scoped reads for the profile/roster forms.

// All departments in a school as {id, name}, alphabetical.
export function listForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.department.findMany({ where: { schoolId: schoolId ?? -1 }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
}

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.department.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}
