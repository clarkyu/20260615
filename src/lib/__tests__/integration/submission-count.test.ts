import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { submittedCountByPhase, submittedCountByAssignment } from '@/lib/repo/assignments'
import type { PrismaClient } from '@prisma/client'

// Backs the edit-form guard: before removing a phase we warn with its (non-DRAFT)
// submission count, because removing a phase cascade-deletes those submissions.

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const s1 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 's1', passwordHash: 'x' } })
  const s2 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 's2', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const assignment = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
  const p1 = await p.phase.create({ data: { assignmentId: assignment.id, order: 1, requireVideo: true, graded: true, maxAttempts: 2 } })
  const p2 = await p.phase.create({ data: { assignmentId: assignment.id, order: 2, requireVideo: true, graded: true, maxAttempts: 1 } })
  return { school, teacher, assignment, p1, p2, s1, s2 }
}

describe('submittedCountByPhase', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('counts non-DRAFT submissions per phase; excludes DRAFT; omits phases with none', async () => {
    const d = await seed(db.prisma)
    // p1: two real submissions (GRADED + UPLOADED) + one DRAFT (must be excluded).
    await db.prisma.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.p1.id, studentId: d.s1.id, attempt: 1, status: 'GRADED' } })
    await db.prisma.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.p1.id, studentId: d.s2.id, attempt: 1, status: 'UPLOADED' } })
    await db.prisma.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.p1.id, studentId: d.s1.id, attempt: 2, status: 'DRAFT' } })
    // p2: nothing submitted.

    const counts = await submittedCountByPhase(db.prisma, d.assignment.id)
    expect(counts.get(d.p1.id)).toBe(2) // DRAFT excluded
    expect(counts.get(d.p2.id)).toBeUndefined() // no submissions → absent (→ 0 via ?? 0 at the call site)
  })
})

describe('submittedCountByAssignment (groupBy dedup — audit P1-3)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('counts DISTINCT students per assignment (a student\'s multiple attempts/phases count once), scoped', async () => {
    const d = await seed(db.prisma)
    const p = db.prisma
    // s1 submits across TWO phases and TWO attempts → still ONE distinct student.
    await p.submission.create({ data: { assignmentId: d.assignment.id, offeringId: null, phaseId: d.p1.id, studentId: d.s1.id, attempt: 1, status: 'GRADED' } })
    await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.p1.id, studentId: d.s1.id, attempt: 2, status: 'UPLOADED' } })
    await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.p2.id, studentId: d.s1.id, attempt: 1, status: 'GRADED' } })
    // s2 submits once.
    await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.p1.id, studentId: d.s2.id, attempt: 1, status: 'UPLOADED' } })
    // a DRAFT-only student must NOT count.
    const s3 = await p.user.create({ data: { role: 'STUDENT', schoolId: d.school.id, studentNo: 's3', passwordHash: 'x' } })
    await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: d.p1.id, studentId: s3.id, attempt: 1, status: 'DRAFT' } })

    const asAdmin = await submittedCountByAssignment(p, d.school.id, d.teacher.id, 'SCHOOL_ADMIN')
    expect(asAdmin.get(d.assignment.id)).toBe(2) // s1 (deduped) + s2; DRAFT-only s3 excluded

    // The teacher who owns the offering sees the same; a different school sees nothing.
    expect((await submittedCountByAssignment(p, d.school.id, d.teacher.id, 'TEACHER')).get(d.assignment.id)).toBe(2)
    expect((await submittedCountByAssignment(p, -999, d.teacher.id, 'SCHOOL_ADMIN')).get(d.assignment.id)).toBeUndefined()
  })
})
