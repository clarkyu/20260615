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

export function create(prisma: PrismaClient, data: { schoolId: number | null; name: string; createdById: number | null; payload: string }) {
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

// 种子/维护用:按校 + 模板名精确查一条(种子幂等的判据;同校同名视为同一模板)。
export function findByNameForSchool(prisma: PrismaClient, schoolId: number, name: string) {
  return prisma.assignmentTemplate.findFirst({ where: { schoolId, name }, select: { id: true } })
}

// 种子/维护用:整体替换模板 payload(题库勘误后重跑种子即生效)。
export function updatePayload(prisma: PrismaClient, id: number, payload: string) {
  return prisma.assignmentTemplate.update({ where: { id }, data: { payload } })
}

// 题库页「笔试试卷」区块:可见模板连 payload 一起取(逐份解析出环节/题型摘要)。
// 模板量小(每校几十份内),payload 随行取可接受;列表页只读。
export function listVisibleWithPayload(prisma: PrismaClient, schoolId: number | null | undefined) {
  return prisma.assignmentTemplate.findMany({
    where: visibleWhere(schoolId),
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, schoolId: true, payload: true, createdBy: { select: { name: true } } },
  })
}
