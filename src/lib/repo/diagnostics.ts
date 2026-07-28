import type { PrismaClient, Role } from '@prisma/client'
import { offeringScopeFor } from './scope'
import { trimBoundaryBatch } from '@/lib/assignment-batches'

// 批阅诊断读(只读聚合,期末考核复盘的产物):队列水位 + 按作业的评阅进度。
// 全部经 offeringScopeFor 钉在本人可见范围;不取任何学生个人信息。

export interface QueueHealth {
  counts: Record<string, number> // PENDING / PROCESSING / FAILED / DONE → 数量
  oldestPendingAt: Date | null // 最老挂起任务的应跑时间——积压信号
}

export async function queueHealth(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role): Promise<QueueHealth> {
  const scope = { submission: { assignment: { offering: offeringScopeFor(schoolId, userId, role) } } }
  const groups = await prisma.gradingJob.groupBy({ by: ['status'], where: scope, _count: { _all: true } })
  const oldest = await prisma.gradingJob.findFirst({
    where: { ...scope, status: 'PENDING' },
    orderBy: { nextAttemptAt: 'asc' },
    select: { nextAttemptAt: true },
  })
  return {
    counts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
    oldestPendingAt: oldest?.nextAttemptAt ?? null,
  }
}

// 死信画像原料(可观测):本人可见范围内 FAILED 任务的 lastError 文本,最老优先、cap 一批。
// lastError 是提供方报错的自由文本(无学生个人信息),分类正则在 domain(classifyGradingError),
// SQL 表达不了——取回后由调用方在 JS 里聚合。500 条足够画像;真超过说明系统已大坏,
// 画像的意义也只剩「哪类最多」。
export function listDeadLetterErrors(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, cap = 500) {
  return prisma.gradingJob.findMany({
    where: { status: 'FAILED', submission: { assignment: { offering: offeringScopeFor(schoolId, userId, role) } } },
    orderBy: { updatedAt: 'asc' },
    take: cap,
    select: { lastError: true },
  })
}

export interface AssignmentProgress {
  assignmentId: number
  title: string
  classId: number
  className: string
  // 批次分组键的原料(诊断页把同批次的班折叠在一张卡下,与作业列表同构):
  batchId: string | null
  courseId: number
  submitted: number // 非草稿、非缺交
  graded: number // GRADED(定稿)
  aiScored: number // 有 AI 分(不论是否已定稿)
  toReview: number // needsReview(老师待批)
  failed: number // 评阅失败
  processing: number // 处理中
}

// 最近 limit 份作业的评阅进度(每行 = 一份作业 = 一个班)。计数用
// (assignmentId, status, needsReview, aiScored) 分组一次取回,id 按 ≤90 分块
// (D1 绑定参数上限,R12 的既有约定)。取 limit+1 探测截断并用 trimBoundaryBatch
// 防止截断点劈开一个批次(同 R12:半批展示会让批次卡缺班)。
export async function gradingProgress(prisma: PrismaClient, schoolId: number | null | undefined, userId: number, role: Role, limit = 45): Promise<AssignmentProgress[]> {
  const fetched = await prisma.assignment.findMany({
    where: { offering: offeringScopeFor(schoolId, userId, role) },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: { id: true, title: true, batchId: true, offering: { select: { courseId: true, classId: true, class: { select: { name: true } } } } },
  })
  const { rows: assignments } = trimBoundaryBatch(fetched.map((a) => ({ ...a, courseId: a.offering.courseId })), limit)
  if (assignments.length === 0) return []

  const byId = new Map<number, AssignmentProgress>(
    assignments.map((a) => [a.id, { assignmentId: a.id, title: a.title, classId: a.offering.classId, className: a.offering.class.name, batchId: a.batchId, courseId: a.offering.courseId, submitted: 0, graded: 0, aiScored: 0, toReview: 0, failed: 0, processing: 0 }]),
  )
  const ids = assignments.map((a) => a.id)
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const groups = await prisma.submission.groupBy({
      by: ['assignmentId', 'status', 'needsReview'],
      where: { assignmentId: { in: chunk } },
      _count: { _all: true },
    })
    for (const g of groups) {
      const row = byId.get(g.assignmentId)
      if (!row) continue
      const n = g._count._all
      if (g.status !== 'DRAFT' && g.status !== 'MISSING') row.submitted += n
      if (g.status === 'GRADED') row.graded += n
      if (g.status === 'FAILED') row.failed += n
      if (g.status === 'PROCESSING') row.processing += n
      if (g.needsReview && g.status !== 'DRAFT' && g.status !== 'MISSING') row.toReview += n
    }
    // aiScored 无法进上面的 groupBy(是「非空判断」不是列值):单独一组计数。
    const scored = await prisma.submission.groupBy({
      by: ['assignmentId'],
      where: { assignmentId: { in: chunk }, aiScore: { not: null } },
      _count: { _all: true },
    })
    for (const s of scored) {
      const row = byId.get(s.assignmentId)
      if (row) row.aiScored = s._count._all
    }
  }
  return [...byId.values()]
}
