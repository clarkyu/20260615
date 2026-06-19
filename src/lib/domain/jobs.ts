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
import { autoGradeById } from './grading'
import { gradeShadowSubmission } from './shadow'
import { runAfterResponse } from '@/lib/cf'
import { getDb } from '@/lib/db'

export type GradingKind = 'submission' | 'shadow'

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
      await gradeShadowSubmission(prisma, job.submissionId, () => heartbeatJob(prisma, job.submissionId))
    } else {
      const r = await autoGradeById(prisma, job.submissionId)
      if (r === null) return { done: true } // nothing to grade — settle, don't loop
      if (!r.ok) error = r.error
    }
  } catch (err) {
    console.error('[jobs] runner threw:', err)
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

  let ran = 0
  for (const job of due) {
    // Atomic claim — only the isolate that flips PENDING→PROCESSING runs it.
    const claimed = await prisma.gradingJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    })
    if (claimed.count === 0) continue
    ran++

    const res = await runner(prisma, { id: job.id, submissionId: job.submissionId, kind: job.kind, attempts: job.attempts })

    // Every terminal write is FENCED to `status: 'PROCESSING'` — a stale run that was
    // already reclaimed (and maybe re-run by another isolate) can't reopen or clobber a
    // job another isolate has since settled.
    if (res.done) {
      await prisma.gradingJob.updateMany({ where: { id: job.id, status: 'PROCESSING' }, data: { status: 'DONE', lastError: null } })
      continue
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
  return { ran }
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
    console.error('[jobs] drain failed:', err)
  }
}

// Post-submit hook: persist the grading job, then kick a background drain so the
// teacher usually only sees exceptions. The drain runs after the response on a
// fresh client; if it's lost (worker eviction) the PENDING job is picked up by a
// later drain or the dashboard self-heal. Keeps actions out of @/lib/db.
export async function scheduleGrading(prisma: PrismaClient, submissionId: number, kind: GradingKind): Promise<void> {
  await enqueueGrading(prisma, submissionId, kind)
  await runAfterResponse(async () => {
    const bg = await getDb()
    await drainGradingJobs(bg)
  })
}
