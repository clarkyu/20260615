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

// AI 建议留痕:写 aiAdviceJson(不动 version——建议不是配置变更);无配置行时先以当前
// 生效配置建行(version=1),保证留痕总有落点。调用方先验 offering 归属。
export async function saveAdvice(
  prisma: PrismaClient,
  offeringId: number,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
  adviceJson: string,
  fallbackConfigJson: string,
): Promise<void> {
  const updated = await prisma.semesterReviewConfig.updateMany({
    where: { offeringId, offering: offeringScopeFor(schoolId, userId, role) },
    data: { aiAdviceJson: adviceJson },
  })
  if (updated.count === 0) {
    await prisma.semesterReviewConfig.create({
      data: { offeringId, configJson: fallbackConfigJson, aiAdviceJson: adviceJson, version: 1, updatedById: userId },
    })
  }
}

// ── 发布快照(SemesterReviewPublish) ────────────────────────────────────────────

// 学生可见 = revokedAt IS NULL 的最大 version;老师端 diff 的「上一版」也用它。
export function latestLivePublish(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.semesterReviewPublish.findFirst({
    where: { offeringId, revokedAt: null, offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, configJson: true, snapshotJson: true, note: true, publishedAt: true },
  })
}

export function listPublishes(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role) {
  return prisma.semesterReviewPublish.findMany({
    where: { offeringId, offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: { version: 'desc' },
    select: { version: true, note: true, publishedAt: true, revokedAt: true },
    take: 20,
  })
}

// 成绩档案总览:一次取出该老师(管理员=全校)所有课头的在线发布版(每课头最大 version)。
export async function latestLivePublishByOffering(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role) {
  const rows = await prisma.semesterReviewPublish.findMany({
    where: { revokedAt: null, offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: [{ offeringId: 'asc' }, { version: 'desc' }],
    select: { offeringId: true, version: true, publishedAt: true },
  })
  const out = new Map<number, { version: number; publishedAt: Date }>()
  for (const r of rows) if (!out.has(r.offeringId)) out.set(r.offeringId, { version: r.version, publishedAt: r.publishedAt })
  return out
}

export async function maxPublishVersion(prisma: PrismaClient, offeringId: number, schoolId: number | null | undefined, userId: number, role: Role): Promise<number> {
  const row = await prisma.semesterReviewPublish.findFirst({
    where: { offeringId, offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return row?.version ?? 0
}

// 单条 create 天然原子(D1 无交互事务也安全);@@unique([offeringId,version]) 防并发双击,
// 撞唯一键返回 'conflict'。调用方先验 offering 归属。
export async function createPublish(
  prisma: PrismaClient,
  params: { offeringId: number; version: number; configJson: string; snapshotJson: string; note: string | null; publishedById: number },
): Promise<'ok' | 'conflict'> {
  try {
    await prisma.semesterReviewPublish.create({ data: params })
    return 'ok'
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') return 'conflict'
    throw e
  }
}

// 撤回=标记(行保留审计);学生端立即回落「未发布」。幂等(已撤回的不再改)。
export function revokePublish(
  prisma: PrismaClient,
  offeringId: number,
  version: number,
  schoolId: number | null | undefined,
  userId: number,
  role: Role,
) {
  return prisma.semesterReviewPublish.updateMany({
    where: { offeringId, version, revokedAt: null, offering: offeringScopeFor(schoolId, userId, role) },
    data: { revokedAt: new Date(), revokedById: userId },
  })
}

// ── 学生端读取(只回本人可见的快照行) ────────────────────────────────────────────

// 学生所在班级各课头的「在线」快照(未撤回最大版):按 offering 分组取最新。
// snapshotJson 含全班行——**绝不整包出 repo**,由 domain extractStudentView 抽本人行+匿名聚合。
export async function listLivePublishesForStudent(prisma: PrismaClient, studentId: number) {
  const rows = await prisma.semesterReviewPublish.findMany({
    where: { revokedAt: null, offering: { class: { studentMemberships: { some: { studentId } } } } },
    orderBy: [{ offeringId: 'asc' }, { version: 'desc' }],
    select: {
      offeringId: true,
      version: true,
      snapshotJson: true,
      configJson: true,
      publishedAt: true,
      offering: { select: { year: true, semester: true, course: { select: { name: true } }, class: { select: { name: true } } } },
    },
  })
  // 每 offering 只保留最大 version(已按 desc 排,取首见)。
  const seen = new Set<number>()
  return rows.filter((r) => (seen.has(r.offeringId) ? false : (seen.add(r.offeringId), true)))
}
