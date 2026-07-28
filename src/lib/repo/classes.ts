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

// What deleting this class would cascade-destroy, for the delete confirmation. Deleting a
// ClassGroup cascades to its CourseOfferings → Assignments → Submissions (+ R2 media),
// which is far more than "the class and its students" — so we surface the real counts so
// an admin tidying a roster can't silently wipe a semester of graded work. Tenant-scoped.
export async function classDeletionImpact(prisma: PrismaClient, classId: number, schoolId: number | null | undefined) {
  const inClass = { classId, schoolId: schoolId ?? -1 }
  const [offerings, assignments, submissions] = await Promise.all([
    prisma.courseOffering.count({ where: inClass }),
    prisma.assignment.count({ where: { offering: inClass } }),
    // non-DRAFT = real submitted/graded work (carries scores + media) that would be lost.
    prisma.submission.count({ where: { status: { not: 'DRAFT' }, assignment: { offering: inClass } } }),
  ])
  return { offerings, assignments, submissions }
}

// All classes in a school as {id, name, 人数}, alphabetical — for offering form selects
// (班级名后带学生人数是全站口径,选班时也要看得到)。
export function listForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.classGroup.findMany({
    where: { schoolId: schoolId ?? -1 },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { studentMemberships: true } } },
  })
}

// Classes with member counts + major/department — the roster index list.
export function listWithCountsForSchool(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.classGroup.findMany({
    where: { schoolId: schoolId ?? -1 },
    orderBy: { name: 'asc' },
    include: { _count: { select: { studentMemberships: true } }, major: { include: { department: { select: { name: true } } } } },
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
// (deleting the class drops their membership, not the student).
export async function deleteWithStudents(prisma: PrismaClient, id: number, schoolId: number | null | undefined): Promise<boolean> {
  const cls = await prisma.classGroup.findFirst({ where: { id, schoolId: schoolId ?? -1 }, select: { id: true } })
  if (!cls) return false

  // Who's in this class right now (by membership).
  const members = await prisma.studentClass.findMany({ where: { classId: id }, select: { studentId: true } })
  const studentIds = members.map((m) => m.studentId)
  // Deleting the class cascades its StudentClass rows away.
  await prisma.classGroup.delete({ where: { id } })
  // A student is orphaned (delete) only if they have no remaining class at all.
  if (studentIds.length) {
    const still = await prisma.studentClass.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true } })
    const stillHasClass = new Set(still.map((s) => s.studentId))
    const orphans = studentIds.filter((sid) => !stillHasClass.has(sid))
    if (orphans.length) await prisma.user.deleteMany({ where: { id: { in: orphans }, role: 'STUDENT' } })
  }
  return true
}

// 成绩档案树:各班学生人数(分母)。只回 classId → 人数,零学生个体数据。
export function classSizes(prisma: PrismaClient, classIds: number[]) {
  return prisma.studentClass.groupBy({
    by: ['classId'],
    where: { classId: { in: classIds } },
    _count: { _all: true },
  })
}
