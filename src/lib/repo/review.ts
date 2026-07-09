// 学期总评仓储:草稿配置(乐观锁)+ 类别级师改分。多租户/越权边界:每个查询都经
// `offering: offeringScopeFor(schoolId, userId, role)` 关系过滤(repo/scope.ts 唯一规则);
// upsert 类无法带关系过滤的写操作,由调用方(action)先用 offeringRepo.findForSchool 验证
// 课头归属后调用(与 grading 的 override 同模式)。
import type { PrismaClient, Role } from '@prisma/client'
import { offeringScopeFor } from './scope'

export function getConfig(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.semesterReviewConfig.findFirst({
    where: { offeringId, offering: offeringScopeFor(schoolId, userId, role) },
    select: { configJson: true, aiAdviceJson: true, version: true, updatedAt: true },
  })
}

// 保存草稿配置(乐观锁):version 匹配才更新;不存在则首建(version=1)。
// 返回 'ok' | 'conflict'。调用方必须已验证 offering 归属(见文件头)。
export async function saveConfig(
  prisma: PrismaClient,
  offeringId: number,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  configJson: string,
  expectedVersion: number,
): Promise<'ok' | 'conflict'> {
  const updated = await prisma.semesterReviewConfig.updateMany({
    where: { offeringId, version: expectedVersion, offering: offeringScopeFor(schoolId, userId, role) },
    data: { configJson, version: { increment: 1 }, updatedById: userId },
  })
  if (updated.count > 0) return 'ok'
  const exists = await prisma.semesterReviewConfig.count({
    where: { offeringId, offering: offeringScopeFor(schoolId, userId, role) },
  })
  if (exists > 0) return 'conflict' // 版本不匹配:他人已改
  if (expectedVersion !== 0) return 'conflict' // 期望非 0 却无行:陈旧客户端
  await prisma.semesterReviewConfig.create({
    data: { offeringId, configJson, version: 1, updatedById: userId },
  })
  return 'ok'
}

export function listOverrides(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.semesterReviewOverride.findMany({
    where: { offeringId, offering: offeringScopeFor(schoolId, userId, role) },
    select: { studentId: true, categoryKey: true, score: true, state: true, reason: true },
  })
}

// 写改分/免计(每 (offering,student,category) 一行,重写即更新)。调用方先验 offering 归属。
export function upsertOverride(
  prisma: PrismaClient,
  params: { offeringId: number; studentId: number; categoryKey: string; score: number | null; state: 'OVERRIDE' | 'EXEMPT'; reason: string | null; createdById: number },
) {
  const { offeringId, studentId, categoryKey, score, state, reason, createdById } = params
  return prisma.semesterReviewOverride.upsert({
    where: { offeringId_studentId_categoryKey: { offeringId, studentId, categoryKey } },
    create: { offeringId, studentId, categoryKey, score, state, reason, createdById },
    update: { score, state, reason, createdById },
  })
}

// 撤销=删行回自动值(关系过滤钉租户;不存在时 count=0,幂等)。
export function deleteOverride(
  prisma: PrismaClient,
  offeringId: number,
  studentId: number,
  categoryKey: string,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
) {
  return prisma.semesterReviewOverride.deleteMany({
    where: { offeringId, studentId, categoryKey, offering: offeringScopeFor(schoolId, userId, role) },
  })
}

// 改分目标须真在该课头的班上(防对任意 studentId 写行)。
export function isStudentInClass(prisma: PrismaClient, classId: number, studentId: number) {
  return prisma.studentClass.count({ where: { classId, studentId } }).then((n) => n > 0)
}
