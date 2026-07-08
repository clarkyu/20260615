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
import { probeObject, type ObjectHealth } from '@/lib/storage'
import { enqueueGradingBulk, kickDrain, deleteJobsForSubmissions } from './jobs'

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

// ── 逐句跟读重评(清扫盲区补漏) ────────────────────────────────────────────────
//
// requeueMediaGrading 只认 videoKey/audioKey,对逐句跟读(shadow)完全瞎——它们的音频在
// ShadowTake 行里。于是一批真背诵(期末收官时发现 163 份、8150 条逐句音频)评阅失败后进了
// 死信,却从没被重评工具捞到过。本函数按 school+title 圈定「有 ShadowTake、失败/卡死/未评」
// 的 shadow 提交,重置成 kind='shadow' 入队(重跑=重置)。与 requeueMediaGrading 同款约定:
// 默认 dry-run 零写入,apply 才执行;幂等;GRADED/无录音不碰。
export async function requeueShadowGrading(prisma: PrismaClient, schoolId: number, title: string, apply: boolean): Promise<RequeueReport> {
  const ids: number[] = []
  const byPhase = new Map<number, number>()
  let after = 0
  for (;;) {
    const rows = await submissions.listShadowGradingTargets(prisma, schoolId, title, after, 500)
    for (const r of rows) {
      ids.push(r.id)
      const order = r.phase?.order ?? 0
      byPhase.set(order, (byPhase.get(order) ?? 0) + 1)
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  if (ids.length === 0) return { ok: false, error: 'no shadow requeue targets for this school+title' }
  const perPhaseOrder = [...byPhase.entries()].map(([phaseOrder, count]) => ({ phaseOrder, count })).sort((a, b) => a.phaseOrder - b.phaseOrder)

  if (!apply) return { ok: true, applied: false, targets: ids.length, perPhaseOrder, jobsCreated: 0, jobsReset: 0 }

  const { created, reset } = await enqueueGradingBulk(prisma, ids, 'shadow')
  await kickDrain()
  return { ok: true, applied: true, targets: ids.length, perPhaseOrder, jobsCreated: created, jobsReset: reset }
}

// ── 上传坏死自动归档(降老师负担) ────────────────────────────────────────────────
//
// 一批提交上传坏死(0 字节键空挂):整段媒体或逐句音频对象缺失(404)或空(416),评阅只会反复
// 失败进死信,却没有任何可评内容,重跑也是死循环。这类不该扔给老师人工——本函数按 school+title
// 圈定死信提交(GradingJob.status='FAILED'),逐个探测其媒体,确认「无内容可评」(所有必需媒体皆
// 空/缺)的归档为缺交(MISSING)并删掉死信任务:随即落出看板的「失败/待批/已交」各计数(MISSING
// 全 codebase 当未提交处理),老师零操作。
//
// 保守判定:任一媒体探测为 'ok'(健康)——有可评内容,不碰(交给重评);夹杂 'unknown'(网络抖/5xx)
// ——判不准,不碰;写作类(有文本、非媒体缺失)跳过。只归档铁证「全空/全缺」的。默认 dry-run 零
// 写入,apply 才执行;幂等(已 MISSING 的下次不再扫)。cap 60/次,more=true 表示还有,续跑即可。
async function probeAll(keys: string[], probe: (key: string) => Promise<ObjectHealth>, concurrency = 8): Promise<ObjectHealth[]> {
  const out: ObjectHealth[] = []
  for (let i = 0; i < keys.length; i += concurrency) {
    out.push(...(await Promise.all(keys.slice(i, i + concurrency).map(probe))))
  }
  return out
}

export type ResolveMissingReport =
  | {
      ok: true
      applied: boolean
      scanned: number
      more: boolean
      missing: number // 归档为缺交的条数
      byKind: Record<string, number>
      skippedHealthy: number // 有健康媒体,留给重评
      skippedUnknown: number // 探测判不准(网络抖/无键),保守不碰
      skippedWriting: number // 写作类:有文本,非媒体缺失
      sampleIds: number[]
    }
  | { ok: false; error: string }

export async function resolveMissingMedia(
  prisma: PrismaClient,
  schoolId: number,
  title: string,
  apply: boolean,
  probe: (key: string) => Promise<ObjectHealth> = probeObject,
): Promise<ResolveMissingReport> {
  const LIMIT = 60
  const rows = await submissions.listStuckGradingTargets(prisma, schoolId, title, LIMIT)
  if (rows.length === 0) return { ok: false, error: 'no stuck/failed grading submissions for this school+title' }

  const missingIds: number[] = []
  const byKind: Record<string, number> = {}
  let skippedHealthy = 0
  let skippedUnknown = 0
  let skippedWriting = 0
  for (const row of rows) {
    const kind = row.gradingJob?.kind ?? 'submission'
    if (kind === 'writing') { skippedWriting++; continue } // 有文本,不是媒体缺失
    const keys = kind === 'shadow'
      ? row.shadowTakes.map((t) => t.audioKey)
      : [row.videoKey, row.audioKey].filter((k): k is string => !!k)
    if (keys.length === 0) { skippedUnknown++; continue } // 没有键可探,判不准
    const healths = await probeAll(keys, probe)
    if (healths.some((h) => h === 'ok')) { skippedHealthy++; continue } // 有可评内容,别归档
    if (healths.every((h) => h === 'missing' || h === 'empty')) {
      missingIds.push(row.id)
      byKind[kind] = (byKind[kind] ?? 0) + 1
    } else {
      skippedUnknown++ // 夹杂 'unknown'——保守不碰,交给下次或重评
    }
  }

  const base = {
    scanned: rows.length,
    more: rows.length === LIMIT,
    missing: missingIds.length,
    byKind,
    skippedHealthy,
    skippedUnknown,
    skippedWriting,
    sampleIds: missingIds.slice(0, 20),
  }
  if (!apply || missingIds.length === 0) return { ok: true, applied: false, ...base }

  await submissions.markSubmissionsMissing(prisma, missingIds, '录音/录像未成功上传（对象缺失或为空），系统已归档为缺交，无需老师处理。')
  await deleteJobsForSubmissions(prisma, missingIds)
  return { ok: true, applied: true, ...base }
}
