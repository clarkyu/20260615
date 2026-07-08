// Durable grading queue.
//
// "Auto-grade on submit" used to be best-effort: one fire-and-forget waitUntil
// call. If the Worker was evicted mid-grade, or the model hiccuped, the work was
// simply lost and the submission sat in the teacher queue forever. This layer
// makes it durable: enqueue persists a job row up front, a drain claims and runs
// due jobs with an atomic guard, failures retry with exponential backoff, and
// exhausted jobs dead-letter (the submission still lives in the teacher queue, so
// nothing is lost). The teacher dashboard drains on load, so stuck/retryable jobs
// self-heal even without new submissions — no cron, no new infrastructure.
//
// D1 has no interactive transactions, so claiming uses the standard optimistic
// pattern: read due rows, then flip PENDING→PROCESSING with a guarded updateMany
// (only the isolate whose update matched actually runs the job).

import type { PrismaClient } from '@prisma/client'
import { logError, logWarn } from '../log'
import { config } from '@/lib/config'
import { autoGradeById } from './grading'
import { autoGradeWritingById } from './grading-writing'
import { gradeShadowSubmission } from './shadow'
import { spendSinceMicroUsd } from '@/lib/repo/ai-usage'
import { runAfterResponse } from '@/lib/cf'
import { getDb } from '@/lib/db'

export type GradingKind = 'submission' | 'shadow' | 'writing'

// After this many tries a job dead-letters instead of retrying forever.
export const MAX_ATTEMPTS = 4
// A PROCESSING row older than this is assumed orphaned (worker died) and reclaimed.
// Shadow grading heartbeats `updatedAt` after every sentence batch (see heartbeatJob),
// so a slow-but-alive run keeps its row fresh — STALE_MS only has to exceed the gap
// BETWEEN heartbeats (one batch of a few sentences) and the single-shot submission
// grade's runtime, both well under this. 15 min still recovers a genuinely dead worker
// reasonably soon.
const STALE_MS = 15 * 60 * 1000
const BASE_BACKOFF_MS = 60 * 1000

// Exponential backoff keyed on the new attempt count (1-based): 1→1m, 2→2m, 3→4m.
export function backoffMs(attempts: number): number {
  return BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1)
}

// The minimal job shape the runner needs (so tests can pass a plain object).
export interface JobRow {
  id: number
  submissionId: number
  kind: string
  attempts: number
}

export type RunOutcome = { done: boolean; error?: string }
export type JobRunner = (prisma: PrismaClient, job: JobRow) => Promise<RunOutcome>

// Default runner: invoke the right grading function, then read the submission's
// status back to decide whether the work actually completed. The grading
// functions own their own status transitions and deliberately swallow "model not
// configured", so the durable layer treats any non-terminal status as "retry
// later" — which is exactly what recovers a transient model outage.
async function defaultRunner(prisma: PrismaClient, job: JobRow): Promise<RunOutcome> {
  let error: string | undefined
  try {
    if (job.kind === 'shadow') {
      // shadow 返回首个 take 的失败原因(若有),交给下面的 lastError——诊断「音频完好却评不出」。
      const shadowErr = await gradeShadowSubmission(prisma, job.submissionId, () => heartbeatJob(prisma, job.submissionId))
      if (shadowErr) error = shadowErr
    } else if (job.kind === 'writing') {
      const r = await autoGradeWritingById(prisma, job.submissionId)
      if (r === null) return { done: true } // nothing to grade — settle, don't loop
      if (!r.ok) error = r.error
    } else {
      const r = await autoGradeById(prisma, job.submissionId)
      if (r === null) return { done: true } // nothing to grade — settle, don't loop
      if (!r.ok) error = r.error
    }
  } catch (err) {
    logError('jobs', 'runner threw', err, { submissionId: job.submissionId })
    return { done: false, error: err instanceof Error ? err.message : String(err) }
  }
  const sub = await prisma.submission.findUnique({ where: { id: job.submissionId }, select: { status: true } })
  if (!sub) return { done: true } // submission deleted — settle
  return { done: sub.status === 'GRADED' || sub.status === 'FLAGGED', error }
}

// Enqueue (or re-arm) the durable grading job for a submission. Idempotent: one
// row per submission (submissionId is unique), so a fresh re-submit resets it to
// PENDING and clears the attempt count.
export async function enqueueGrading(prisma: PrismaClient, submissionId: number, kind: GradingKind): Promise<void> {
  const now = new Date()
  await prisma.gradingJob.upsert({
    where: { submissionId },
    create: { submissionId, kind, status: 'PENDING', attempts: 0, nextAttemptAt: now },
    update: { kind, status: 'PENDING', attempts: 0, nextAttemptAt: now, lastError: null },
  })
}

// Claim and run due jobs. Safe to call from any request — the post-submit kick or
// the teacher-dashboard self-heal. Reclaims orphaned PROCESSING rows first, then
// claims each due job with a guarded flip so two isolates never double-run one.
// The `runner` seam keeps the state machine unit-testable without AI/storage.
export async function claimAndRunDue(
  prisma: PrismaClient,
  limit = 5,
  runner: JobRunner = defaultRunner,
): Promise<{ ran: number }> {
  const now = new Date()

  // 0) 支出护栏(期末考核复盘 #4):当天 AiUsageLog 累计花费 ≥ 单日上限时,暂停后台评阅——
  //    队列原样保留,次日归零(或调高上限)后自动恢复。这是第二道防线,补在 Gemini 控制台
  //    硬上限之后(一次批处理一天曾烧 ~$500)。放在最前:暂停就是彻底不动,连回收/夭折都不做,
  //    免得停摆期白白累加 attempts 把任务熬进死信。手动重评(runGrading)不走此路径,老师随时可评。
  //    cap=0 = 关闭护栏。用 UTC 日界,与账本 createdAt(DB CURRENT_TIMESTAMP)同一时钟。
  const capUsd = config.gradingDailyCapUsd()
  if (capUsd > 0) {
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const spentMicro = await spendSinceMicroUsd(prisma, startOfTodayUtc)
    if (spentMicro >= capUsd * 1_000_000) {
      logWarn('jobs', 'daily grading spend cap reached — pausing background grading', undefined, { capUsd, spentUsd: (spentMicro / 1_000_000).toFixed(2) })
      return { ran: 0 }
    }
  }

  // 1) Reclaim orphans AS A FAILED ATTEMPT: a worker that died mid-job (or a job that
  //    outran STALE_MS) left a stale PROCESSING row. Counting the reclaim as an attempt
  //    means a submission that repeatedly crashes the isolate eventually dead-letters
  //    instead of looping forever and re-spending AI on every reclaim.
  await prisma.gradingJob.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: new Date(now.getTime() - STALE_MS) } },
    data: { status: 'PENDING', attempts: { increment: 1 } },
  })

  // 2) Dead-letter anything that has now exhausted its attempts (via failures or
  //    reclaims) so it never re-runs.
  await prisma.gradingJob.updateMany({
    where: { status: 'PENDING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', lastError: 'grading did not complete after retries' },
  })

  // 3) Due PENDING jobs, oldest first.
  const due = await prisma.gradingJob.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  })

  // Claim sequentially (cheap row flips), then run the claimed batch CONCURRENTLY:
  // 一批的墙钟 ≈ 最慢一份而不是各份之和(期末考核修复 ⑦——视频评一份 1-3 分钟,串行
  // 两份就顶穿调用方的超时;并行后同批互不叠加)。每份的结算写入仍各自独立、且全部
  // FENCED 到 PROCESSING(见下),并发不会互相踩。
  const claimed: typeof due = []
  for (const job of due) {
    // Atomic claim — only the isolate that flips PENDING→PROCESSING runs it.
    const c = await prisma.gradingJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    })
    if (c.count > 0) claimed.push(job)
  }

  const runOne = async (job: (typeof due)[number]) => {
    const res = await runner(prisma, { id: job.id, submissionId: job.submissionId, kind: job.kind, attempts: job.attempts })

    // Every terminal write is FENCED to `status: 'PROCESSING'` — a stale run that was
    // already reclaimed (and maybe re-run by another isolate) can't reopen or clobber a
    // job another isolate has since settled.
    if (res.done) {
      await prisma.gradingJob.updateMany({ where: { id: job.id, status: 'PROCESSING' }, data: { status: 'DONE', lastError: null } })
      return
    }

    const attempts = job.attempts + 1
    const lastError = res.error ? res.error.slice(0, 500) : null
    if (attempts >= MAX_ATTEMPTS) {
      // Dead-letter: stop retrying. The submission stays in the teacher queue
      // (needsReview), so the work is surfaced, just no longer auto-graded.
      await prisma.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: { status: 'FAILED', attempts, lastError: lastError ?? 'grading did not complete' },
      })
    } else {
      await prisma.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: { status: 'PENDING', attempts, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError },
      })
    }
  }
  await Promise.all(claimed.map(runOne))
  return { ran: claimed.length }
}

// 撤销一个环节全部提交的待跑评阅任务(环节改型为客观题/投票后,不该再有 AI 回来写分)。
// 只删 PENDING——PROCESSING 的让它自然结束,其终态写入受提交状态围栏保护。
// 按关系过滤(submission.phaseId)而非 id 列表:一次删净、不受 D1 绑定参数上限约束,
// 也天然覆盖读计划与执行之间新入队的任务(复查 R18)。
export async function cancelPendingForPhase(prisma: PrismaClient, phaseId: number): Promise<number> {
  const res = await prisma.gradingJob.deleteMany({ where: { status: 'PENDING', submission: { phaseId } } })
  return res.count
}

// 删除一批提交的评阅任务(维护:上传坏死的提交归档为缺交后,其死信任务不再有意义,一并清掉,
// 死信数随之归零)。按 submissionId 集合删,分块避开 D1 绑定参数上限。调用方传的是已 scope 的 id。
export async function deleteJobsForSubmissions(prisma: PrismaClient, submissionIds: number[]): Promise<number> {
  const CHUNK = 80
  let n = 0
  for (let i = 0; i < submissionIds.length; i += CHUNK) {
    const res = await prisma.gradingJob.deleteMany({ where: { submissionId: { in: submissionIds.slice(i, i + CHUNK) } } })
    n += res.count
  }
  return n
}

// Keep a running job's row fresh so the stale-reclaim (which keys on `updatedAt`) never
// treats a slow-but-alive run as orphaned and double-runs it (wasting AI spend). Fenced
// to PROCESSING so it never disturbs a job another isolate has already settled or
// reclaimed. Writing `status` to its own value still bumps the @updatedAt column.
export function heartbeatJob(prisma: PrismaClient, submissionId: number) {
  return prisma.gradingJob.updateMany({ where: { submissionId, status: 'PROCESSING' }, data: { status: 'PROCESSING' } })
}

// Fire-and-forget drain for background use (runAfterResponse / waitUntil). Never
// throws — a drain failure must not surface to the student or teacher.
export async function drainGradingJobs(prisma: PrismaClient, limit = 5): Promise<void> {
  try {
    await claimAndRunDue(prisma, limit)
  } catch (err) {
    logError('jobs', 'drain failed', err)
  }
}

// 批量补登(维护用):给一批提交补建评阅任务。与 enqueueGrading 同语义(已有任务重置为
// PENDING、没有则新建),但按集合写:D1 绑定参数 ≤100/查询,子请求数不随行数线性放大
// (Workers 有子请求上限,几百行逐条 upsert 会撞)。分块内 先查已有 → 重置已有 → 新建缺失。
export async function enqueueGradingBulk(prisma: PrismaClient, submissionIds: number[], kind: GradingKind): Promise<{ created: number; reset: number }> {
  const CHUNK = 40 // createMany 每行 ~2 个绑定参数,40 行远在 100 限内
  const now = new Date()
  let created = 0
  let reset = 0
  for (let i = 0; i < submissionIds.length; i += CHUNK) {
    const ids = submissionIds.slice(i, i + CHUNK)
    const existing = new Set((await prisma.gradingJob.findMany({ where: { submissionId: { in: ids } }, select: { submissionId: true } })).map((j) => j.submissionId))
    const toReset = ids.filter((id) => existing.has(id))
    const toCreate = ids.filter((id) => !existing.has(id))
    if (toReset.length > 0) {
      const r = await prisma.gradingJob.updateMany({
        where: { submissionId: { in: toReset } },
        data: { kind, status: 'PENDING', attempts: 0, nextAttemptAt: now, lastError: null },
      })
      reset += r.count
    }
    if (toCreate.length > 0) {
      const c = await prisma.gradingJob.createMany({ data: toCreate.map((submissionId) => ({ submissionId, kind })) })
      created += c.count
    }
  }
  return { created, reset }
}

// Background drain kick (post-response, fresh client) — shared by the post-submit hook
// and maintenance backfills. Loss-tolerant: a lost kick just leaves PENDING jobs for the
// cron drain / dashboard self-heal.
export async function kickDrain(): Promise<void> {
  await runAfterResponse(async () => {
    const bg = await getDb()
    await drainGradingJobs(bg)
  })
}

// Post-submit hook: persist the grading job, then kick a background drain so the
// teacher usually only sees exceptions. The drain runs after the response on a
// fresh client; if it's lost (worker eviction) the PENDING job is picked up by a
// later drain or the dashboard self-heal. Keeps actions out of @/lib/db.
export async function scheduleGrading(prisma: PrismaClient, submissionId: number, kind: GradingKind): Promise<void> {
  await enqueueGrading(prisma, submissionId, kind)
  await kickDrain()
}
