import type { PrismaClient } from '@prisma/client'

// Major (专业) data access. Scoped reads for the roster/class flows.

export function findForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.major.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}
