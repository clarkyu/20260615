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

// All classes in a school as {id, name}, alphabetical — for offering form selects.
export function listForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.classGroup.findMany({ where: { schoolId: schoolId ?? -1 }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
}

// A class with this name in the school other than `exceptId` (uniqueness check).
export function findDupName(prisma: PrismaClient, schoolId: number, name: string, exceptId?: number) {
  return prisma.classGroup.findFirst({ where: { schoolId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
}

export function createForSchool(prisma: PrismaClient, data: { schoolId: number; name: string; grade?: string | null; majorId?: number | null }) {
  return prisma.classGroup.create({ data })
}

export function update(prisma: PrismaClient, id: number, data: { name?: string; grade?: string | null; majorId?: number | null }) {
  return prisma.classGroup.update({ where: { id }, data })
}

// Delete a class and its students iff it belongs to the school; returns success.
export async function deleteWithStudents(prisma: PrismaClient, id: number, schoolId: number | null | undefined): Promise<boolean> {
  const cls = await prisma.classGroup.findFirst({ where: { id, schoolId: schoolId ?? -1 }, select: { id: true } })
  if (!cls) return false
  await prisma.user.deleteMany({ where: { classId: id, role: 'STUDENT' } })
  await prisma.classGroup.delete({ where: { id } })
  return true
}
