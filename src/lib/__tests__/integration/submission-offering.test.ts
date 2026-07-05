import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import * as submissionRepo from '@/lib/repo/submissions'
import type { PrismaClient } from '@prisma/client'

// The denormalized Submission.offeringId (audit P1-2/P1-3): per-offering analytics reads
// filter on the offeringId column + @@index([offeringId, status]) instead of joining
// through Assignment → CourseOffering. Correctness hinges on (a) every write populating
// offeringId and (b) the read returning exactly the offering's rows. Proven here in real SQL.

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const student = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 's1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offA = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const offB = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  const asgA = await p.assignment.create({ data: { offeringId: offA.id, title: 'A' } })
  const asgB = await p.assignment.create({ data: { offeringId: offB.id, title: 'B' } })
  const phaseA = await p.phase.create({ data: { assignmentId: asgA.id, order: 1, requireVideo: true, graded: true, maxAttempts: 3 } })
  return { offA, offB, asgA, asgB, phaseA, student }
}

describe('Submission.offeringId denormalization (real SQL)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('the write path denormalizes offeringId onto the new row', async () => {
    const d = await seed(db.prisma)
    const sub = await submissionRepo.upsertDraftWithMedia(db.prisma, d.asgA.id, d.offA.id, d.phaseA.id, d.student.id, 1, { videoKey: 'v' })
    expect(sub.offeringId).toBe(d.offA.id)
  })

  it('listForOfferingLatestFirst filters by the denormalized offeringId — other offerings and DRAFT excluded', async () => {
    const d = await seed(db.prisma)
    const p = db.prisma
    await p.submission.create({ data: { assignmentId: d.asgA.id, offeringId: d.offA.id, phaseId: d.phaseA.id, studentId: d.student.id, attempt: 1, status: 'GRADED', finalScore: 80 } })
    await p.submission.create({ data: { assignmentId: d.asgB.id, offeringId: d.offB.id, phaseId: null, studentId: d.student.id, attempt: 1, status: 'GRADED', finalScore: 60 } }) // other offering
    await p.submission.create({ data: { assignmentId: d.asgA.id, offeringId: d.offA.id, phaseId: d.phaseA.id, studentId: d.student.id, attempt: 2, status: 'DRAFT' } }) // excluded

    const rows = await submissionRepo.listForOfferingLatestFirst(p, d.offA.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ assignmentId: d.asgA.id, finalScore: 80 })
  })
})
