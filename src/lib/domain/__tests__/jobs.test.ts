import { describe, it, expect, vi } from 'vitest'
import { claimAndRunDue, enqueueGrading, heartbeatJob, maintainGradingJobs, backoffMs, backoffMsFor, classifyGradingError, fairOrder, MAX_ATTEMPTS, AUTO_REQUEUE_MARKER, type JobRunner } from '../jobs'

// ── A tiny in-memory stand-in for the bits of prisma.gradingJob the queue uses ──

interface Job {
  id: number
  submissionId: number
  kind: string
  status: string
  attempts: number
  nextAttemptAt: Date
  lastError: string | null
  updatedAt: Date
}

// The submission fields the maintenance phantom-reconcile filters on.
interface Sub {
  status: string
  aiScore: number | null
  teacherScore: number | null
}

function matchCond(fv: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>
    if ('in' in c) return (c.in as unknown[]).includes(fv)
    if ('not' in c) return fv !== c.not
    if ('contains' in c) return typeof fv === 'string' && fv.includes(c.contains as string)
    if ('lte' in c && !((fv as never) <= (c.lte as never))) return false
    if ('lt' in c && !((fv as never) < (c.lt as never))) return false
    if ('gte' in c && !((fv as never) >= (c.gte as never))) return false
    return true
  }
  return fv === cond
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>, subs?: Record<number, Sub>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(v as Record<string, unknown>[]).some((w) => matches(row, w, subs))) return false
      continue
    }
    if (k === 'submission') {
      const sub = subs?.[row.submissionId as number]
      if (!sub || !matches(sub as never, v as Record<string, unknown>, subs)) return false
      continue
    }
    if (!matchCond(row[k], v)) return false
  }
  return true
}

// `ledgerMicro` is the platform-wide AiUsageLog spend the breaker sees (default 0 =
// never trips). The fake ignores the createdAt filter — the breaker just SUMs it.
// `subs` backs the maintenance phantom-reconcile's relation filter, keyed by submissionId.
function fakePrisma(jobs: Job[], ledgerMicro = 0, subs: Record<number, Sub> = {}) {
  let nextId = jobs.reduce((m, j) => Math.max(m, j.id), 0) + 1
  const touch = (j: Job) => (j.updatedAt = new Date())
  return {
    _jobs: jobs,
    aiUsageLog: {
      async aggregate() { return { _sum: { costMicroUsd: ledgerMicro } } },
    },
    gradingJob: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async updateMany({ where, data }: any) {
        let count = 0
        for (const j of jobs) if (matches(j as never, where, subs)) {
          for (const [k, v] of Object.entries(data)) {
            // Model Prisma's atomic increment: { attempts: { increment: 1 } }
            if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as object)) {
              ;(j as never as Record<string, number>)[k] += (v as { increment: number }).increment
            } else {
              ;(j as never as Record<string, unknown>)[k] = v
            }
          }
          touch(j); count++
        }
        return { count }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async findMany({ where, orderBy, take }: any) {
        let res = jobs.filter((j) => matches(j as never, where, subs))
        if (orderBy?.nextAttemptAt === 'asc') res = [...res].sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
        if (orderBy?.updatedAt === 'asc') res = [...res].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        return take ? res.slice(0, take) : res
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async update({ where, data }: any) {
        const j = jobs.find((x) => x.id === where.id)!
        Object.assign(j, data); touch(j)
        return j
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async upsert({ where, create, update }: any) {
        const j = jobs.find((x) => x.submissionId === where.submissionId)
        if (j) { Object.assign(j, update); touch(j); return j }
        const created: Job = { id: nextId++, lastError: null, updatedAt: new Date(), ...create }
        jobs.push(created)
        return created
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function job(over: Partial<Job> = {}): Job {
  return { id: 1, submissionId: 100, kind: 'submission', status: 'PENDING', attempts: 0, nextAttemptAt: new Date(Date.now() - 1000), lastError: null, updatedAt: new Date(), ...over }
}

const ok: JobRunner = async () => ({ done: true })
const fail: JobRunner = async () => ({ done: false, error: 'boom' })

describe('claimAndRunDue', () => {
  it('runs a due job and marks it DONE', async () => {
    const jobs = [job()]
    const db = fakePrisma(jobs)
    const runner = vi.fn(ok)
    const { ran } = await claimAndRunDue(db, 5, runner)
    expect(ran).toBe(1)
    expect(runner).toHaveBeenCalledOnce()
    expect(jobs[0].status).toBe('DONE')
  })

  it('reschedules with exponential backoff when not done', async () => {
    const jobs = [job({ attempts: 0 })]
    const db = fakePrisma(jobs)
    const before = Date.now()
    await claimAndRunDue(db, 5, fail)
    expect(jobs[0].status).toBe('PENDING')
    expect(jobs[0].attempts).toBe(1)
    expect(jobs[0].lastError).toBe('boom')
    expect(jobs[0].nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + backoffMs(1))
  })

  it('dead-letters after MAX_ATTEMPTS', async () => {
    const jobs = [job({ attempts: MAX_ATTEMPTS - 1 })]
    const db = fakePrisma(jobs)
    await claimAndRunDue(db, 5, fail)
    expect(jobs[0].status).toBe('FAILED')
    expect(jobs[0].attempts).toBe(MAX_ATTEMPTS)
  })

  it('skips a job whose nextAttemptAt is still in the future', async () => {
    const jobs = [job({ nextAttemptAt: new Date(Date.now() + 60_000) })]
    const db = fakePrisma(jobs)
    const runner = vi.fn(ok)
    const { ran } = await claimAndRunDue(db, 5, runner)
    expect(ran).toBe(0)
    expect(runner).not.toHaveBeenCalled()
    expect(jobs[0].status).toBe('PENDING')
  })

  it('reclaims a stale PROCESSING job and runs it', async () => {
    const jobs = [job({ status: 'PROCESSING', updatedAt: new Date(Date.now() - 20 * 60_000) })]
    const db = fakePrisma(jobs)
    const { ran } = await claimAndRunDue(db, 5, ok)
    expect(ran).toBe(1)
    expect(jobs[0].status).toBe('DONE')
  })

  it('leaves a fresh PROCESSING job alone', async () => {
    const jobs = [job({ status: 'PROCESSING', updatedAt: new Date() })]
    const db = fakePrisma(jobs)
    const runner = vi.fn(ok)
    const { ran } = await claimAndRunDue(db, 5, runner)
    expect(ran).toBe(0)
    expect(runner).not.toHaveBeenCalled()
    expect(jobs[0].status).toBe('PROCESSING')
  })

  it('counts a stale-reclaim as an attempt (so a crash-loop is bounded)', async () => {
    const jobs = [job({ status: 'PROCESSING', attempts: 1, updatedAt: new Date(Date.now() - 20 * 60_000) })]
    const db = fakePrisma(jobs)
    await claimAndRunDue(db, 5, ok)
    expect(jobs[0].attempts).toBe(2) // reclaim incremented before the run
    expect(jobs[0].status).toBe('DONE')
  })

  it('dead-letters a stale job that has exhausted attempts via reclaim, without re-running', async () => {
    const jobs = [job({ status: 'PROCESSING', attempts: MAX_ATTEMPTS - 1, updatedAt: new Date(Date.now() - 20 * 60_000) })]
    const db = fakePrisma(jobs)
    const runner = vi.fn(ok)
    const { ran } = await claimAndRunDue(db, 5, runner)
    expect(jobs[0].status).toBe('FAILED') // reclaim → attempts hit MAX → dead-lettered
    expect(runner).not.toHaveBeenCalled()
    expect(ran).toBe(0)
  })

  // ── spend circuit breaker (#4) ── default cap is $50 (GRADING_DAILY_CAP_USD unset).
  it('pauses (runs nothing, touches nothing) once today’s spend hits the daily cap', async () => {
    const jobs = [job()] // a due job that WOULD run if not paused
    const db = fakePrisma(jobs, 50_000_000) // $50 today == cap → paused
    const runner = vi.fn(ok)
    const { ran } = await claimAndRunDue(db, 5, runner)
    expect(ran).toBe(0)
    expect(runner).not.toHaveBeenCalled()
    // Pause must NOT burn an attempt or reclaim/dead-letter — the queue is preserved as-is.
    expect(jobs[0]).toMatchObject({ status: 'PENDING', attempts: 0 })
  })

  it('runs normally when today’s spend is still under the cap', async () => {
    const jobs = [job()]
    const db = fakePrisma(jobs, 49_999_999) // just under $50 → not paused
    const runner = vi.fn(ok)
    const { ran } = await claimAndRunDue(db, 5, runner)
    expect(ran).toBe(1)
    expect(jobs[0].status).toBe('DONE')
  })

  // ── kind lane filter ── drain one queue lane so a fast lane isn't starved behind a
  // slow, earlier-enqueued lane in the strict nextAttemptAt FIFO.
  it('with a kind filter, claims ONLY that lane even when another lane is older', async () => {
    // shadow enqueued earlier (would win the FIFO) + writing enqueued later.
    const jobs = [
      job({ id: 1, submissionId: 100, kind: 'shadow', nextAttemptAt: new Date(Date.now() - 60_000) }),
      job({ id: 2, submissionId: 200, kind: 'writing', nextAttemptAt: new Date(Date.now() - 30_000) }),
    ]
    const db = fakePrisma(jobs)
    const runner = vi.fn(ok)
    const { ran } = await claimAndRunDue(db, 5, runner, 'writing')
    expect(ran).toBe(1)
    expect(jobs[1].status).toBe('DONE') // writing ran
    expect(jobs[0].status).toBe('PENDING') // older shadow left untouched
  })

  it('without a kind filter, drains all lanes oldest-first (unchanged default)', async () => {
    const jobs = [
      job({ id: 1, submissionId: 100, kind: 'shadow', nextAttemptAt: new Date(Date.now() - 60_000) }),
      job({ id: 2, submissionId: 200, kind: 'writing', nextAttemptAt: new Date(Date.now() - 30_000) }),
    ]
    const db = fakePrisma(jobs)
    const { ran } = await claimAndRunDue(db, 5, ok)
    expect(ran).toBe(2)
    expect(jobs.every((j) => j.status === 'DONE')).toBe(true)
  })
})

describe('enqueueGrading', () => {
  it('creates a PENDING job, and re-enqueue resets attempts/status', async () => {
    const jobs: Job[] = []
    const db = fakePrisma(jobs)
    await enqueueGrading(db, 100, 'shadow')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ submissionId: 100, kind: 'shadow', status: 'PENDING', attempts: 0 })

    jobs[0].status = 'FAILED'; jobs[0].attempts = 4; jobs[0].lastError = 'old'
    await enqueueGrading(db, 100, 'shadow')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null })
  })
})

describe('heartbeatJob', () => {
  it('refreshes a PROCESSING job so a slow-but-alive run is not reclaimed', async () => {
    const stale = new Date(Date.now() - 10 * 60_000)
    const jobs = [job({ status: 'PROCESSING', submissionId: 100, updatedAt: stale })]
    const res = await heartbeatJob(fakePrisma(jobs), 100)
    expect(res.count).toBe(1)
    expect(jobs[0].updatedAt.getTime()).toBeGreaterThan(stale.getTime())
  })

  it('is fenced to PROCESSING — it never touches a settled/pending job', async () => {
    const jobs = [job({ status: 'PENDING', submissionId: 100 })]
    expect((await heartbeatJob(fakePrisma(jobs), 100)).count).toBe(0)
  })
})

describe('backoffMs', () => {
  it('doubles each attempt from a 1-minute base', () => {
    expect(backoffMs(1)).toBe(60_000)
    expect(backoffMs(2)).toBe(120_000)
    expect(backoffMs(3)).toBe(240_000)
  })
})

// ── 自愈闭环:错误分类 + 差异化退避 ──────────────────────────────────────────────

describe('classifyGradingError', () => {
  it('classifies rate-limit signatures (真实签名:上传初始化 429 / generateContent 429 body)', () => {
    expect(classifyGradingError('Gemini 文件上传初始化失败 429')).toBe('rate')
    expect(classifyGradingError('Gemini 429: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')).toBe('rate')
    expect(classifyGradingError('Rate limit reached for requests')).toBe('rate')
    expect(classifyGradingError('You exceeded your current quota')).toBe('rate')
  })

  it('classifies permanent (ungradeable content) signatures', () => {
    expect(classifyGradingError('The video is corrupt or in an unsupported format')).toBe('permanent')
    expect(classifyGradingError('Gemini 400: {"error":{"status":"INVALID_ARGUMENT"}}')).toBe('permanent')
    expect(classifyGradingError('视频无法解码')).toBe('permanent')
  })

  it('rate wins over permanent when both signatures appear (429 body 里的字样不判死)', () => {
    expect(classifyGradingError('Gemini 429: quota exceeded for unsupported tier')).toBe('rate')
  })

  it('classifies not-ready (File API still processing)', () => {
    expect(classifyGradingError('Gemini 文件未就绪（PROCESSING）')).toBe('not-ready')
    expect(classifyGradingError('file is not ready')).toBe('not-ready')
  })

  it('defaults everything else to transient (5xx / timeouts / transient 404 / null)', () => {
    expect(classifyGradingError('Gemini 500: internal')).toBe('transient')
    expect(classifyGradingError('err.mediaUnavailable')).toBe('transient')
    expect(classifyGradingError('grading did not complete after retries')).toBe('transient')
    expect(classifyGradingError(null)).toBe('transient')
    expect(classifyGradingError('boom')).toBe('transient')
  })
})

describe('backoffMsFor', () => {
  it('rate backs off from a 10-minute base, not-ready from 30s, transient from 1m', () => {
    expect(backoffMsFor('rate', 1)).toBe(600_000)
    expect(backoffMsFor('rate', 2)).toBe(1_200_000)
    expect(backoffMsFor('not-ready', 1)).toBe(30_000)
    expect(backoffMsFor('not-ready', 2)).toBe(60_000)
    expect(backoffMsFor('transient', 1)).toBe(60_000)
  })
})

describe('claimAndRunDue — error-class handling', () => {
  it('dead-letters a permanent failure IMMEDIATELY (no attempts burned on re-billing a corrupt video)', async () => {
    const jobs = [job({ attempts: 0 })]
    const db = fakePrisma(jobs)
    const corrupt: JobRunner = async () => ({ done: false, error: 'The video is corrupt or in an unsupported format' })
    await claimAndRunDue(db, 5, corrupt)
    expect(jobs[0].status).toBe('FAILED')
    expect(jobs[0].attempts).toBe(1)
  })

  it('backs a rate-limited failure off on the LONG schedule (≥10min, not 1min)', async () => {
    const jobs = [job({ attempts: 0 })]
    const db = fakePrisma(jobs)
    const before = Date.now()
    const rated: JobRunner = async () => ({ done: false, error: 'Gemini 文件上传初始化失败 429' })
    await claimAndRunDue(db, 5, rated)
    expect(jobs[0].status).toBe('PENDING')
    expect(jobs[0].nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 600_000)
  })

  it('backs a not-ready failure off on the SHORT schedule (~30s — resume, not re-upload)', async () => {
    const jobs = [job({ attempts: 0 })]
    const db = fakePrisma(jobs)
    const start = Date.now()
    const notReady: JobRunner = async () => ({ done: false, error: 'Gemini 文件未就绪（PROCESSING）' })
    await claimAndRunDue(db, 5, notReady)
    expect(jobs[0].status).toBe('PENDING')
    const delta = jobs[0].nextAttemptAt.getTime() - start
    expect(delta).toBeGreaterThanOrEqual(29_000)
    expect(delta).toBeLessThan(60_000)
  })

  it('preserves the auto-requeue marker when a rescued job fails again (runOne path)', async () => {
    const jobs = [job({ attempts: 0, lastError: `old error ${AUTO_REQUEUE_MARKER}` })]
    const db = fakePrisma(jobs)
    await claimAndRunDue(db, 5, fail)
    expect(jobs[0].status).toBe('PENDING')
    expect(jobs[0].lastError).toContain('boom')
    expect(jobs[0].lastError).toContain(AUTO_REQUEUE_MARKER)
  })

  it('preserves the auto-requeue marker through the exhausted-attempts dead-letter sweep', async () => {
    // Exhausted via reclaims → dead-lettered by step 2's updateMany, not runOne.
    const jobs = [job({ attempts: MAX_ATTEMPTS, lastError: `old error ${AUTO_REQUEUE_MARKER}` })]
    const db = fakePrisma(jobs)
    await claimAndRunDue(db, 5, ok)
    expect(jobs[0].status).toBe('FAILED')
    expect(jobs[0].lastError).toContain(AUTO_REQUEUE_MARKER)
  })
})

// ── 自愈闭环:队列维护(幽灵对账 + 可救死信自动复活) ─────────────────────────────

const HOURS_7 = 7 * 60 * 60 * 1000

describe('maintainGradingJobs', () => {
  it('reconciles a phantom dead letter (submission already graded) to DONE', async () => {
    const jobs = [job({ status: 'FAILED', submissionId: 100, lastError: 'boom' })]
    const db = fakePrisma(jobs, 0, { 100: { status: 'GRADED', aiScore: 88, teacherScore: null } })
    const report = await maintainGradingJobs(db)
    expect(report.phantomDone).toBe(1)
    expect(jobs[0].status).toBe('DONE')
    expect(jobs[0].lastError).toBeNull()
  })

  it('reconciles a phantom PENDING job too, and honors teacherScore as "has a score"', async () => {
    const jobs = [job({ status: 'PENDING', submissionId: 100 })]
    const db = fakePrisma(jobs, 0, { 100: { status: 'FLAGGED', aiScore: null, teacherScore: 60 } })
    const report = await maintainGradingJobs(db)
    expect(report.phantomDone).toBe(1)
    expect(jobs[0].status).toBe('DONE')
  })

  it('leaves a job alone when its submission has no score or is not settled', async () => {
    const jobs = [
      job({ id: 1, submissionId: 100, status: 'FAILED', lastError: 'x', updatedAt: new Date() }),
      job({ id: 2, submissionId: 200, status: 'PENDING' }),
    ]
    const db = fakePrisma(jobs, 0, {
      100: { status: 'GRADED', aiScore: null, teacherScore: null }, // settled but scoreless — not a phantom
      200: { status: 'UPLOADED', aiScore: null, teacherScore: null }, // live queue work
    })
    const report = await maintainGradingJobs(db)
    expect(report.phantomDone).toBe(0)
    expect(jobs[0].status).toBe('FAILED')
    expect(jobs[1].status).toBe('PENDING')
  })

  it('auto-requeues an old rescuable dead letter ONCE, marking it', async () => {
    const jobs = [job({ status: 'FAILED', attempts: 4, lastError: 'Gemini 文件上传初始化失败 429', updatedAt: new Date(Date.now() - HOURS_7) })]
    const db = fakePrisma(jobs)
    const report = await maintainGradingJobs(db)
    expect(report.requeued).toBe(1)
    expect(jobs[0]).toMatchObject({ status: 'PENDING', attempts: 0 })
    expect(jobs[0].lastError).toContain(AUTO_REQUEUE_MARKER)

    // A second maintenance pass must NOT resurrect it again (marker fences it out)…
    jobs[0].status = 'FAILED'
    jobs[0].updatedAt = new Date(Date.now() - HOURS_7)
    const again = await maintainGradingJobs(db)
    expect(again.requeued).toBe(0)
    expect(jobs[0].status).toBe('FAILED')
  })

  it('never requeues a permanent dead letter or a fresh one', async () => {
    const jobs = [
      job({ id: 1, submissionId: 100, status: 'FAILED', lastError: 'The video is corrupt', updatedAt: new Date(Date.now() - HOURS_7) }),
      job({ id: 2, submissionId: 200, status: 'FAILED', lastError: 'boom', updatedAt: new Date() }), // younger than the 6h cool-off
    ]
    const db = fakePrisma(jobs)
    const report = await maintainGradingJobs(db)
    expect(report.requeued).toBe(0)
    expect(jobs.every((j) => j.status === 'FAILED')).toBe(true)
  })

  it('caps rescues per run at 20', async () => {
    const jobs = Array.from({ length: 25 }, (_, i) =>
      job({ id: i + 1, submissionId: 100 + i, status: 'FAILED', lastError: 'Gemini 500: internal', updatedAt: new Date(Date.now() - HOURS_7) }))
    const db = fakePrisma(jobs)
    const report = await maintainGradingJobs(db)
    expect(report.requeued).toBe(20)
    expect(jobs.filter((j) => j.status === 'PENDING')).toHaveLength(20)
    expect(jobs.filter((j) => j.status === 'FAILED')).toHaveLength(5)
  })
})

// ── 削峰公平 + 截止优先(fairOrder) ─────────────────────────────────────────────

describe('fairOrder', () => {
  const NOW = new Date('2026-07-12T08:00:00Z')
  const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000)
  const fj = (kind: string, minAgo: number, dueAt?: Date | null) => ({
    kind,
    nextAttemptAt: at(minAgo),
    ...(dueAt !== undefined ? { submission: { phase: { dueAt } } } : {}),
  })

  it('轮转交错各泳道,慢泳道积压不再饿死快泳道', () => {
    // shadow 全比 writing 老:严格 FIFO 会把前 3 个槽全给 shadow。
    const jobs = [fj('shadow', 60), fj('shadow', 50), fj('shadow', 40), fj('writing', 5)]
    const picked = fairOrder(jobs, 3, NOW)
    expect(picked.map((j) => j.kind)).toEqual(['shadow', 'writing', 'shadow'])
  })

  it('泳道内截止已过/24h 内的优先,其次 nextAttemptAt 老的先走', () => {
    const pastDue = fj('submission', 10, new Date(NOW.getTime() - 60_000)) // 已过截止
    const dueSoon = fj('submission', 5, new Date(NOW.getTime() + 60 * 60_000)) // 1h 内截止
    const dueFar = fj('submission', 60, new Date(NOW.getTime() + 48 * 60 * 60_000)) // 两天后
    const noDue = fj('submission', 90, null)
    const picked = fairOrder([noDue, dueFar, dueSoon, pastDue], 4, NOW)
    // 截止桶 0(pastDue 比 dueSoon 老)→ 桶 1 按等待时长(noDue 90min > dueFar 60min)。
    expect(picked).toEqual([pastDue, dueSoon, noDue, dueFar])
  })

  it('尊重 limit,且 dueAt 缺失(测试桩/无截止)不炸、归常规桶', () => {
    const jobs = [fj('submission', 30), fj('shadow', 20), fj('writing', 10), fj('submission', 5)]
    const picked = fairOrder(jobs, 2, NOW)
    expect(picked).toHaveLength(2)
    expect(picked[0].kind).toBe('submission')
    expect(picked[1].kind).toBe('shadow')
  })

  it('空输入 → 空输出', () => {
    expect(fairOrder([], 5, NOW)).toEqual([])
  })
})
