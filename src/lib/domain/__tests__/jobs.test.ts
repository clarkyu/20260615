import { describe, it, expect, vi } from 'vitest'
import { claimAndRunDue, enqueueGrading, heartbeatJob, backoffMs, MAX_ATTEMPTS, type JobRunner } from '../jobs'

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

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    const fv = row[k] as never
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const cond = v as Record<string, unknown>
      if ('lte' in cond && !(fv <= (cond.lte as never))) return false
      if ('lt' in cond && !(fv < (cond.lt as never))) return false
      if ('gte' in cond && !(fv >= (cond.gte as never))) return false
    } else if (fv !== v) return false
  }
  return true
}

function fakePrisma(jobs: Job[]) {
  let nextId = jobs.reduce((m, j) => Math.max(m, j.id), 0) + 1
  const touch = (j: Job) => (j.updatedAt = new Date())
  return {
    _jobs: jobs,
    gradingJob: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async updateMany({ where, data }: any) {
        let count = 0
        for (const j of jobs) if (matches(j as never, where)) {
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
        let res = jobs.filter((j) => matches(j as never, where))
        if (orderBy?.nextAttemptAt === 'asc') res = [...res].sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
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
