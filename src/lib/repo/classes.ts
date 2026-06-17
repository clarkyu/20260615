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

// Classes with member counts + major/department — the roster index list.
export function listWithCountsForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.classGroup.findMany({
    where: { schoolId: schoolId ?? -1 },
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } }, major: { include: { department: { select: { name: true } } } } },
  })
}

// One class with its major + department — the class-manager header.
export function findDetailForSchool(prisma: PrismaClient, id: number, schoolId: number | null | undefined) {
  return prisma.classGroup.findFirst({
    where: { id, schoolId: schoolId ?? -1 },
    include: { major: { include: { department: { select: { name: true } } } } },
  })
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

// Delete a class iff it belongs to the school; returns success. Students who only
// belong to this class are deleted; students who are also in OTHER classes are kept
// (deleting the class drops their membership/primary link, not the student).
export async function deleteWithStudents(prisma: PrismaClient, id: number, schoolId: number | null | undefined): Promise<boolean> {
  const cls = await prisma.classGroup.findFirst({ where: { id, schoolId: schoolId ?? -1 }, select: { id: true } })
  if (!cls) return false

  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', OR: [{ classId: id }, { classMemberships: { some: { classId: id } } }] },
    select: { id: true, classId: true, classMemberships: { select: { classId: true } } },
  })
  // Deleting the class cascades its memberships and SetNulls a primary classId === id.
  await prisma.classGroup.delete({ where: { id } })
  // A student is orphaned (delete) only if they have no remaining class at all.
  const orphans = students
    .filter((s) => {
      const others = new Set(s.classMemberships.map((m) => m.classId).filter((c) => c !== id))
      if (s.classId != null && s.classId !== id) others.add(s.classId)
      return others.size === 0
    })
    .map((s) => s.id)
  if (orphans.length) await prisma.user.deleteMany({ where: { id: { in: orphans } } })
  return true
}
