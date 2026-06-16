import type { PrismaClient } from '@prisma/client'

// Tenant-scoped reads for class groups (班级). The `?? -1` sentinel ensures a
// staff member without a school can never match another school's rows.

export async function findClassIdsForSchool(
  prisma: PrismaClient,
  ids: number[],
  schoolId: number | null | undefined,
): Promise<number[]> {
  const rows = await prisma.classGroup.findMany({
    where: { id: { in: ids }, schoolId: schoolId ?? -1 },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export function findClassForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.classGroup.findFirst({ where: { id, schoolId: schoolId ?? -1 } })
}
