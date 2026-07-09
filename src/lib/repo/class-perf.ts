// 课堂表现(雨课堂导入)仓储:导入台账与每生原始信号的读取。写入(导入落库)随导入链路 PR 补。
// 多租户边界:一律经 offering / import.offering 关系套 offeringScopeFor。
import type { PrismaClient, Role } from '@prisma/client'
import { offeringScopeFor } from './scope'

const IMPORT_SELECT = {
  id: true,
  fileName: true,
  sessionsJson: true,
  weightsJson: true,
  rowCount: true,
  matchedCount: true,
  unmatchedCount: true,
  duplicateCount: true,
  createdAt: true,
} as const

export function latestImport(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.classPerfImport.findFirst({
    where: { offeringId, offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: { createdAt: 'desc' },
    select: IMPORT_SELECT,
  })
}

// 学期总评配置钉住的那次导入(importId 漂移防线):按 id 取,仍钉课头+租户。
export function importById(prisma: PrismaClient, id: number, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.classPerfImport.findFirst({
    where: { id, offeringId, offering: offeringScopeFor(schoolId, userId, role) },
    select: IMPORT_SELECT,
  })
}

export function listImportStudents(prisma: PrismaClient, importId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.classPerfStudent.findMany({
    where: { importId, import: { offering: offeringScopeFor(schoolId, userId, role) } },
    select: { studentNo: true, userId: true, name: true, summaryJson: true, detailJson: true },
    orderBy: { studentNo: 'asc' },
  })
}
