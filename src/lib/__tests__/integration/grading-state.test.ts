import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { freshDb, type TestDb } from './harness'
import * as submissionRepo from '@/lib/repo/submissions'
import type { GradeResult } from '@/lib/repo/submissions'

// The grading status state machine. An AI run CLAIMS a submission (markProcessing →
// PROCESSING), then every terminal write (applyGradeResult / applyShadowResult /
// markFailed / revertToQueue) is FENCED with `where status: 'PROCESSING'` — so a stale or
// double run that no longer owns the row writes nothing. The teacher override, by
// contrast, is an unconditional update that always wins. The unit tests assert the `where`
// shape against a mock; here we prove the fence actually holds in real SQL — including the
// crown-jewel race: a late AI grade must NOT clobber a teacher's override.

async function seed(p: PrismaClient): Promise<{ subId: number; teacherId: number }> {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'C', code: 'C' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'K' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
  const stu = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 's1', passwordHash: 'x' } })
  const sub = await p.submission.create({ data: { assignmentId: asg.id, studentId: stu.id, attempt: 1, status: 'UPLOADED' } })
  return { subId: sub.id, teacherId: teacher.id }
}

const gradeResult = (over: Partial<GradeResult> = {}): GradeResult => ({
  status: 'GRADED', needsReview: false, confidence: 0.9, perceptionModel: 'p', judgeModel: 'j',
  transcript: 't', aiResult: '{}', aiScore: 60, finalScore: 60, feedback: 'ok', gradedById: null, ...over,
})

describe('grading status state machine (real SQL)', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('markProcessing claims the submission; applyGradeResult then finalizes it (happy path)', async () => {
    const p = db.prisma
    const { subId } = await seed(p)
    await submissionRepo.markProcessing(p, subId)
    expect((await p.submission.findUnique({ where: { id: subId } }))!.status).toBe('PROCESSING')

    const res = await submissionRepo.applyGradeResult(p, subId, gradeResult({ aiScore: 72, finalScore: 72 }))
    expect(res.count).toBe(1)
    expect(await p.submission.findUnique({ where: { id: subId } })).toMatchObject({
      status: 'GRADED', aiScore: 72, finalScore: 72, needsReview: false,
    })
  })

  it('a teacher override that wins the race is NOT clobbered by a late AI grade (the fence)', async () => {
    const p = db.prisma
    const { subId, teacherId } = await seed(p)
    await submissionRepo.markProcessing(p, subId) // an AI run claims it
    // …but the teacher finalizes first → GRADED, score 95 (unconditional update).
    await submissionRepo.applyTeacherOverride(p, subId, { teacherScore: 95, finalScore: 95, feedback: 'teacher', gradedById: teacherId })
    // The slow AI run now tries to write its result — it must match ZERO rows.
    const res = await submissionRepo.applyGradeResult(p, subId, gradeResult({ aiScore: 60, finalScore: 60 }))
    expect(res.count).toBe(0)

    const sub = (await p.submission.findUnique({ where: { id: subId } }))!
    expect(sub).toMatchObject({ status: 'GRADED', finalScore: 95, teacherScore: 95, needsReview: false })
    expect(sub.aiScore).toBeNull() // the AI write never landed
  })

  it('markFailed and revertToQueue act only on a PROCESSING row', async () => {
    const p = db.prisma
    const { subId } = await seed(p)
    // Still UPLOADED (not claimed) → markFailed is a no-op.
    expect((await submissionRepo.markFailed(p, subId)).count).toBe(0)
    expect((await p.submission.findUnique({ where: { id: subId } }))!.status).toBe('UPLOADED')

    // Claimed → revertToQueue sends it back to the teacher queue.
    await submissionRepo.markProcessing(p, subId)
    const res = await submissionRepo.revertToQueue(p, subId, 'UPLOADED')
    expect(res.count).toBe(1)
    expect(await p.submission.findUnique({ where: { id: subId } })).toMatchObject({ status: 'UPLOADED', needsReview: true })
  })

  it('applyShadowResult is fenced to PROCESSING as well', async () => {
    const p = db.prisma
    const { subId } = await seed(p)
    const shadow = { needsReview: false, aiScore: 80, finalScore: 80, confidence: 0.8, feedback: 'f' }
    // Not claimed → no-op.
    expect((await submissionRepo.applyShadowResult(p, subId, shadow)).count).toBe(0)
    // Claimed → finalizes.
    await submissionRepo.markProcessing(p, subId)
    expect((await submissionRepo.applyShadowResult(p, subId, shadow)).count).toBe(1)
    expect(await p.submission.findUnique({ where: { id: subId } })).toMatchObject({ status: 'GRADED', aiScore: 80, finalScore: 80 })
  })
})
