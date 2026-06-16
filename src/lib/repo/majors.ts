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
