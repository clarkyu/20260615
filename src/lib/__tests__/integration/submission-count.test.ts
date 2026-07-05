import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { submittedCountByPhase } from '@/lib/repo/assignments'
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
  return { assignment, p1, p2, s1, s2 }
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
