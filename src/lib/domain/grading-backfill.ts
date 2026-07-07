// 评阅补登(一次性维护,期末考核复盘):
//
// AI 文本评分(writing 任务)上线晚于一批已提交的默写/自由文本作答——提交时没有任何
// 代码给它们建评阅任务(队列里 kind='writing' 的任务数为 0),这批行一直以「已上传+
// 待复核」躺在老师队列里。本模块按 学校+标题 圈定作业,把符合条件的行批量补进耐久
// 评阅队列;顺带清掉纯投票环节上的幽灵复核标记(投票不复核,历史遗留虚增看板待批数)。
//
// 与 unify-poll-phase 同款约定:默认 dry-run 零写入,apply 才执行;幂等(重跑时已入队
// 的重置、已清的不再计数);评阅本身仍走耐久队列的既有围栏(objective 自弃、GRADED
// 不覆盖、老师分优先),补登只负责「把任务放进队列」。

import type { PrismaClient } from '@prisma/client'
import * as submissions from '@/lib/repo/submissions'
import { enqueueGradingBulk, kickDrain } from './jobs'

export type BackfillReport =
  | {
      ok: true
      applied: boolean
      // 写作补评候选(按作业分布,供核对「是不是预期的那批」)
      writingCandidates: number
      perAssignment: { assignmentId: number; count: number }[]
      // apply 时的实际写入;dry-run 为 0
      jobsCreated: number
      jobsReset: number
      // 纯投票环节的幽灵复核标记(dry-run 报数量,apply 报清掉的数量)
      ghostReview: number
    }
  | { ok: false; error: string }

export async function backfillWritingGrading(prisma: PrismaClient, schoolId: number, title: string, apply: boolean): Promise<BackfillReport> {
  const rows = await submissions.listWritingBackfillCandidates(prisma, schoolId, title)
  const ghostCount = await submissions.countGhostPollReview(prisma, schoolId, title)
  if (rows.length === 0 && ghostCount === 0) return { ok: false, error: 'nothing to backfill for this school+title' }

  const byAssignment = new Map<number, number>()
  for (const r of rows) byAssignment.set(r.assignmentId, (byAssignment.get(r.assignmentId) ?? 0) + 1)
  const perAssignment = [...byAssignment.entries()].map(([assignmentId, count]) => ({ assignmentId, count })).sort((a, b) => a.assignmentId - b.assignmentId)

  if (!apply) {
    return { ok: true, applied: false, writingCandidates: rows.length, perAssignment, jobsCreated: 0, jobsReset: 0, ghostReview: ghostCount }
  }

  const { created, reset } = await enqueueGradingBulk(prisma, rows.map((r) => r.id), 'writing')
  const cleared = await submissions.clearGhostPollReview(prisma, schoolId, title)
  // 响应后踢一脚排空;队列大头交给 5 分钟一班的 cron drain 消化。
  await kickDrain()
  return { ok: true, applied: true, writingCandidates: rows.length, perAssignment, jobsCreated: created, jobsReset: reset, ghostReview: cleared.count }
}

// ── 媒体重评(期末考核修复 ③) ────────────────────────────────────────────────
//
// 媒体探针证实:449 份「评阅失败/卡死/未评」的视频里 98% 的对象完好——历史 404 是
// 暂时性取件失败,不是数据丢失。本函数把这批行的评阅任务批量重置入队(kind
// 'submission',重跑=重置)。卡在 PROCESSING 的行不用单独解套:claimForProcessing
// 现在会接管过期的 PROCESSING(claim 陷阱已修),重评任务跑到它们时自然接管。
// 真正缺失/空文件的少数行会在评前预检下快速走到「评阅失败」,老师人工处理。

export type RequeueReport =
  | {
      ok: true
      applied: boolean
      targets: number
      perPhaseOrder: { phaseOrder: number; count: number }[]
      jobsCreated: number
      jobsReset: number
    }
  | { ok: false; error: string }

export async function requeueMediaGrading(prisma: PrismaClient, schoolId: number, title: string, apply: boolean): Promise<RequeueReport> {
  // 与媒体探针同口径(同一个 repo 读),游标翻页取全量 id。
  const ids: number[] = []
  const byPhase = new Map<number, number>()
  let after = 0
  for (;;) {
    const rows = await submissions.listMediaProbeTargets(prisma, schoolId, title, after, 500)
    for (const r of rows) {
      ids.push(r.id)
      const order = r.phase?.order ?? 0
      byPhase.set(order, (byPhase.get(order) ?? 0) + 1)
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  if (ids.length === 0) return { ok: false, error: 'no requeue targets for this school+title' }
  const perPhaseOrder = [...byPhase.entries()].map(([phaseOrder, count]) => ({ phaseOrder, count })).sort((a, b) => a.phaseOrder - b.phaseOrder)

  if (!apply) return { ok: true, applied: false, targets: ids.length, perPhaseOrder, jobsCreated: 0, jobsReset: 0 }

  const { created, reset } = await enqueueGradingBulk(prisma, ids, 'submission')
  await kickDrain()
  return { ok: true, applied: true, targets: ids.length, perPhaseOrder, jobsCreated: created, jobsReset: reset }
}
