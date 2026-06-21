import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { freshDb, type TestDb } from './harness'
import { enqueueGrading, claimAndRunDue, MAX_ATTEMPTS } from '@/lib/domain/jobs'

// The durable grading queue's claim/retry/dead-letter/reclaim logic is pure SQL
// (guarded updateMany, no interactive transactions on D1). The unit tests assert it
// against a mocked prisma; these run the REAL SQL through SQLite so the optimistic
// claim, the backoff scheduling, the attempt-exhaustion dead-letter, and the
// orphan-reclaim actually behave. The `runner` seam injects a fake grader, so no
// AI/storage is involved — only the queue's own state machine.

async function seedSubmission(p: PrismaClient): Promise<number> {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'C', code: 'C' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'K' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
  const stu = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 'stu', passwordHash: 'x' } })
  const sub = await p.submission.create({ data: { assignmentId: asg.id, studentId: stu.id, attempt: 1, status: 'UPLOADED' } })
  return sub.id
}

const okRunner = async () => ({ done: true })
const failRunner = async () => ({ done: false, error: 'boom' })

describe('durable grading queue (real SQL)', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('enqueue → drain claims the due job once and marks it DONE', async () => {
    const p = db.prisma
    const subId = await seedSubmission(p)
    await enqueueGrading(p, subId, 'submission')
    const { ran } = await claimAndRunDue(p, 5, okRunner)
    expect(ran).toBe(1)
    expect(await p.gradingJob.findUnique({ where: { submissionId: subId } })).toMatchObject({ status: 'DONE', lastError: null })
  })

  it('a failing job retries with backoff, then dead-letters after MAX_ATTEMPTS', async () => {
    const p = db.prisma
    const subId = await seedSubmission(p)
    await enqueueGrading(p, subId, 'submission')
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      // Re-arm: the previous failure pushed nextAttemptAt into the future (backoff).
      await p.gradingJob.updateMany({ where: { submissionId: subId, status: 'PENDING' }, data: { nextAttemptAt: new Date() } })
      await claimAndRunDue(p, 5, failRunner)
      const job = (await p.gradingJob.findUnique({ where: { submissionId: subId } }))!
      if (i < MAX_ATTEMPTS) {
        expect(job).toMatchObject({ status: 'PENDING', attempts: i })
        expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now()) // backoff scheduled it forward
        expect(job.lastError).toBe('boom')
      } else {
        expect(job).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS })
        expect(job.lastError).toBeTruthy()
      }
    }
  })

  it('skips a job whose nextAttemptAt is still in the future (not due)', async () => {
    const p = db.prisma
    const subId = await seedSubmission(p)
    await enqueueGrading(p, subId, 'submission')
    await p.gradingJob.updateMany({ where: { submissionId: subId }, data: { nextAttemptAt: new Date(Date.now() + 60_000) } })
    const { ran } = await claimAndRunDue(p, 5, okRunner)
    expect(ran).toBe(0)
    expect((await p.gradingJob.findUnique({ where: { submissionId: subId } }))!.status).toBe('PENDING')
  })

  it('re-enqueue resets a half-failed job to PENDING with a clean slate (idempotent upsert)', async () => {
    const p = db.prisma
    const subId = await seedSubmission(p)
    await enqueueGrading(p, subId, 'submission')
    await claimAndRunDue(p, 5, failRunner) // attempts → 1, lastError set
    expect(await p.gradingJob.findUnique({ where: { submissionId: subId } })).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'boom' })
    await enqueueGrading(p, subId, 'submission') // student re-submits
    expect(await p.gradingJob.findUnique({ where: { submissionId: subId } })).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null })
  })

  it('dead-letters a PENDING job that already exhausted its attempts (reclaim accounting)', async () => {
    const p = db.prisma
    const subId = await seedSubmission(p)
    await enqueueGrading(p, subId, 'submission')
    await p.gradingJob.updateMany({ where: { submissionId: subId }, data: { attempts: MAX_ATTEMPTS } })
    const { ran } = await claimAndRunDue(p, 5, okRunner)
    expect(ran).toBe(0) // exhausted job is failed before it can be claimed
    expect((await p.gradingJob.findUnique({ where: { submissionId: subId } }))!.status).toBe('FAILED')
  })

  it('reclaims an orphaned PROCESSING row as a failed attempt, then re-runs it', async () => {
    const p = db.prisma
    const subId = await seedSubmission(p)
    await enqueueGrading(p, subId, 'submission')
    await p.gradingJob.updateMany({ where: { submissionId: subId }, data: { status: 'PROCESSING' } })
    const job0 = (await p.gradingJob.findUnique({ where: { submissionId: subId } }))!
    // Backdate updatedAt beyond STALE_MS (15 min) — a worker that died mid-job.
    const stale = new Date(Date.now() - 30 * 60 * 1000)
    await p.$executeRaw`UPDATE "GradingJob" SET "updatedAt" = ${stale} WHERE id = ${job0.id}`
    const { ran } = await claimAndRunDue(p, 5, okRunner)
    expect(ran).toBe(1) // reclaimed → PENDING (attempts +1), then claimed + run
    expect(await p.gradingJob.findUnique({ where: { submissionId: subId } })).toMatchObject({ status: 'DONE', attempts: 1 })
  })
})
