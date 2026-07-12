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
const RATE_BACKOFF_MS = 10 * 60 * 1000
const NOT_READY_BACKOFF_MS = 30 * 1000

// Exponential backoff keyed on the new attempt count (1-based): 1→1m, 2→2m, 3→4m.
export function backoffMs(attempts: number): number {
  return backoffMsFor('transient', attempts)
}

// ── 错误分类(自愈闭环):按 lastError 的签名区分失败类别,差异化处置 ──────────────
//
// permanent —— 内容本身评不了(视频损坏/格式不支持/无效参数):重试必然同样失败,还要再
//   烧一次感知费 → 不再重试,立即死信(交 resolve-missing-media 归档或人工)。
// rate —— 上游限流(429/quota/RESOURCE_EXHAUSTED,期末 429 墙曾造成 ~492 死信):分钟级
//   退避只会撞回同一堵墙,改 10 分钟级起步的长退避,让墙先退。
// not-ready —— Gemini File API 还在转码(文件未就绪):通常几十秒内 ACTIVE,短退避快速接续
//   (句柄已存回提交行,重试是续跑不是重传)。
// transient —— 其它(网络抖/5xx/超时/暂时性 404):维持原指数退避。
//
// 匹配顺序 rate → permanent → not-ready:429 响应体若碰巧含 "unsupported" 之类字样,
// 也绝不能被误判成 permanent 直接死信——限流永远先认。
export type GradingErrorClass = 'permanent' | 'rate' | 'not-ready' | 'transient'

export function classifyGradingError(lastError: string | null | undefined): GradingErrorClass {
  if (!lastError) return 'transient'
  if (/\b429\b|rate.?limit|too.?many.?requests?|quota|resource.?exhausted/i.test(lastError)) return 'rate'
  if (/corrupt|unsupported|invalid.?argument|无法解码/i.test(lastError)) return 'permanent'
  if (/not.?ready|未就绪/i.test(lastError)) return 'not-ready'
  return 'transient'
}

// Backoff for a retryable failure, keyed on its error class (permanent never retries).
export function backoffMsFor(cls: GradingErrorClass, attempts: number): number {
  const base = cls === 'rate' ? RATE_BACKOFF_MS : cls === 'not-ready' ? NOT_READY_BACKOFF_MS : BASE_BACKOFF_MS
  return base * 2 ** Math.max(0, attempts - 1)
}

// 自动复活标记(见 maintainGradingJobs):带此标记的死信已被自动重排过一次,绝不二次复活
// (防「复活→再死→再复活」慢循环烧钱)。标记跟着 lastError 走,后续失败重写 lastError 时
// 必须保住它(runOne / 死信化两处都处理)。
export const AUTO_REQUEUE_MARKER = '[auto-requeued]'

// ── 削峰公平 + 截止优先(排空次序) ────────────────────────────────────────────────
//
// 严格 nextAttemptAt-FIFO 会把每个槽位都发给最早入队的泳道:一批又慢又老的逐句积压
// (Gemini,一份几分钟)能让又快又新的写作(DeepSeek,一份几秒)饿死几小时——期末实况,
// 此前只能靠人工带 kind 单独泵。现在默认排空就公平:
//   泳道内 —— 截止已过/24h 内的先走(作业刚收齐、师生都在等分),再按 nextAttemptAt;
//   泳道间 —— submission/shadow/writing 轮转各取一个,直到批量配额满。
// 带 kind 的单泳道排空维持单道次序(同样吃截止优先)。纯函数,便于单测。
export const DEADLINE_SOON_MS = 24 * 60 * 60 * 1000
const LANES: GradingKind[] = ['submission', 'shadow', 'writing']

interface FairJob {
  kind: string
  nextAttemptAt: Date
  submission?: { phase?: { dueAt: Date | null } | null } | null
}

export function fairOrder<T extends FairJob>(jobs: T[], limit: number, now: Date): T[] {
  // 截止桶:0 = 已过或 24h 内截止(优先),1 = 其余。取不到 dueAt(测试桩/无截止)归 1。
  const bucket = (j: T) => {
    const due = j.submission?.phase?.dueAt
    return due && due.getTime() <= now.getTime() + DEADLINE_SOON_MS ? 0 : 1
  }
  const lanes = new Map<string, T[]>()
  for (const j of jobs) {
    const lane = lanes.get(j.kind)
    if (lane) lane.push(j)
    else lanes.set(j.kind, [j])
  }
  for (const lane of lanes.values()) {
    lane.sort((a, b) => bucket(a) - bucket(b) || a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
  }
  const out: T[] = []
  while (out.length < limit) {
    let advanced = false
    for (const lane of lanes.values()) {
      if (out.length >= limit) break
      const j = lane.shift()
      if (j) {
        out.push(j)
        advanced = true
      }
    }
    if (!advanced) break
  }
  return out
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
  kind?: GradingKind,
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
  //    reclaims) so it never re-runs. 拆两笔:先把带自动复活标记的死信化并保住标记
  //    (不然标记被覆盖,复活过的死信会被 maintainGradingJobs 再次复活),再收其余的。
  await prisma.gradingJob.updateMany({
    where: { status: 'PENDING', attempts: { gte: MAX_ATTEMPTS }, lastError: { contains: AUTO_REQUEUE_MARKER } },
    data: { status: 'FAILED', lastError: `grading did not complete after retries ${AUTO_REQUEUE_MARKER}` },
  })
  await prisma.gradingJob.updateMany({
    where: { status: 'PENDING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', lastError: 'grading did not complete after retries' },
  })

  // 3) Due PENDING jobs——泳道公平 + 截止优先(fairOrder):无 kind 时三条泳道各取一窗
  //    候选再轮转交错,慢泳道积压不再饿死快泳道;泳道内截止已过/临近的先走。带 kind 仍
  //    是单泳道(人工/定向泵)。每道窗口取 3×limit:截止优先只在窗口内重排,窗口外的
  //    急件等下一班(cron 几分钟一班,足够)。dueAt 只为排序取用,不进 runner。
  const jobInclude = { submission: { select: { phase: { select: { dueAt: true } } } } } as const
  const laneWindow = (k: GradingKind) =>
    prisma.gradingJob.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now }, kind: k },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit * 3,
      include: jobInclude,
    })
  const candidates = kind ? await laneWindow(kind) : (await Promise.all(LANES.map(laneWindow))).flat()
  const due = fairOrder(candidates, limit, now)

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
    const cls = classifyGradingError(res.error)
    // 自动复活标记随行携带:这行任务若是复活来的(旧 lastError 带标记),新的失败信息也要
    // 把标记续上,否则它死信后会被当成"没救过"再次复活。
    const marker = job.lastError?.includes(AUTO_REQUEUE_MARKER) ? AUTO_REQUEUE_MARKER : ''
    const withMarker = (msg: string | null) => (marker ? (msg ? `${msg} ${marker}` : marker) : msg)
    const lastError = res.error ? res.error.slice(0, 500) : null
    if (cls === 'permanent' || attempts >= MAX_ATTEMPTS) {
      // Dead-letter: stop retrying. permanent(内容本身评不了)不烧剩余重试次数,立即死信。
      // The submission stays in the teacher queue (needsReview), so the work is
      // surfaced, just no longer auto-graded.
      await prisma.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: { status: 'FAILED', attempts, lastError: withMarker(lastError ?? 'grading did not complete') },
      })
    } else {
      await prisma.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: { status: 'PENDING', attempts, nextAttemptAt: new Date(now.getTime() + backoffMsFor(cls, attempts)), lastError: withMarker(lastError) },
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

// ── 队列自愈维护(自愈闭环):cron drain 每班先跑这个,再排空 ────────────────────────
//
// 两件此前只能靠人工点 Actions 按钮的事,收进机器例行:
//   ① 幽灵对账(平台级):提交已评出分、落在 GRADED/FLAGGED,评阅任务却还挂着
//      FAILED/PENDING(评过一次拿到分,后来被重排又失败到顶的那种)。重评没意义(已有分),
//      唯一正解是把任务对账成 DONE——否则只虚增看板「失败/死信」数。与 reconcile-graded-jobs
//      端点同判据,但不限学校、每班 cron 自动扫。
//   ② 可救死信自动复活(限一次):死信里 lastError 属 rate/transient/not-ready 类的
//      (限流墙/网络抖/上游 5xx),等 RESCUE_MIN_AGE_MS 风头过后自动重排一次;permanent
//      (内容损坏)绝不复活——重试必然同样失败还烧钱,等 resolve-missing-media 归档。
//      复活时给 lastError 打 AUTO_REQUEUE_MARKER,带标记的绝不二次复活(防慢循环)。
//      每次 cap RESCUE_CAP 条:复活即重评、重评烧钱,小批多班消化,护在单日支出护栏之内。
//
// 幂等、平台级(不做租户 scope:维护的是队列自身,不读不写任何按校数据)、每步独立生效。
const RESCUE_MIN_AGE_MS = 6 * 60 * 60 * 1000
const RESCUE_CAP = 20
// 每班最多扫这么多条最老的死信来分类。permanent 死信会一直留在窗口里(等归档清走),
// 窗口给大一点,免得少量损坏媒体把可救的挡在窗外。
const RESCUE_SCAN = 400

export type MaintenanceReport = { phantomDone: number; requeued: number }

export async function maintainGradingJobs(prisma: PrismaClient): Promise<MaintenanceReport> {
  const now = new Date()

  // ① 幽灵对账:任务 FAILED/PENDING 但提交已有分且已落稳定态 → DONE。
  //    只认 FAILED/PENDING——PROCESSING 可能正在评,交给 runner 的围栏终态,别去抢。
  //    (重评路径不冲突:regrade 在入队前先把提交重置回 UPLOADED,不会命中这里的谓词。)
  const phantom = await prisma.gradingJob.updateMany({
    where: {
      status: { in: ['FAILED', 'PENDING'] },
      submission: {
        status: { in: ['GRADED', 'FLAGGED'] },
        OR: [{ aiScore: { not: null } }, { teacherScore: { not: null } }],
      },
    },
    data: { status: 'DONE', lastError: null },
  })

  // ② 可救死信复活:最老的先扫,JS 里分类(错误签名是正则,SQL 表达不了)。
  const failed = await prisma.gradingJob.findMany({
    where: { status: 'FAILED', updatedAt: { lt: new Date(now.getTime() - RESCUE_MIN_AGE_MS) } },
    orderBy: { updatedAt: 'asc' },
    take: RESCUE_SCAN,
    select: { id: true, lastError: true },
  })
  const rescuable = failed
    .filter((j) => !(j.lastError ?? '').includes(AUTO_REQUEUE_MARKER))
    .filter((j) => classifyGradingError(j.lastError) !== 'permanent')
    .slice(0, RESCUE_CAP)
  let requeued = 0
  for (const j of rescuable) {
    // 围栏到 FAILED:读与写之间若被人工重排/删除,这里就不动它。
    const r = await prisma.gradingJob.updateMany({
      where: { id: j.id, status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: now,
        lastError: `${(j.lastError ?? 'failed').slice(0, 450)} ${AUTO_REQUEUE_MARKER}`,
      },
    })
    requeued += r.count
  }
  if (phantom.count > 0 || requeued > 0) {
    logWarn('jobs', 'queue maintenance', undefined, { phantomDone: phantom.count, requeued })
  }
  return { phantomDone: phantom.count, requeued }
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
