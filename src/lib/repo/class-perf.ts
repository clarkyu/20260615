// 课堂表现(雨课堂导入)仓储:导入台账与每生原始信号的读写。
// 多租户边界:读取一律经 offering / import.offering 关系套 offeringScopeFor;
// 写入的课头归属由 action 层先经 offeringRepo.findForSchool 校验(与 review 仓储同模式)。
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

// ── 写入(导入落库) ────────────────────────────────────────────────────────────

export function createImport(
  prisma: PrismaClient,
  data: {
    offeringId: number
    fileName: string
    sessionsJson: string
    weightsJson: string
    rowCount: number
    matchedCount: number
    unmatchedCount: number
    duplicateCount: number
    importedById: number
  },
) {
  return prisma.classPerfImport.create({ data, select: { id: true } })
}

export interface NewClassPerfStudent {
  importId: number
  studentNo: string
  userId: number | null
  name: string | null
  summaryJson: string
  detailJson: string
}

// D1 每查询 ~100 个绑定参数;6 字段/行 → 14 行/批留足裕量。顺序分批,无交互事务
// (中途失败由 domain 层删台账行级联清理)。
const STUDENT_CHUNK = 14

export async function createStudents(prisma: PrismaClient, rows: NewClassPerfStudent[]) {
  for (let i = 0; i < rows.length; i += STUDENT_CHUNK) {
    await prisma.classPerfStudent.createMany({ data: rows.slice(i, i + STUDENT_CHUNK) })
  }
}

// 仅供分批写失败后的清理:按 (id, offeringId) 双钉删除,级联清掉已写学生行。
export function deleteImportById(prisma: PrismaClient, id: number, offeringId: number) {
  return prisma.classPerfImport.deleteMany({ where: { id, offeringId } })
}
