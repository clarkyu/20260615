import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { updateAssignment, type PhaseDraft } from '@/lib/domain/assignments'
import type { PrismaClient } from '@prisma/client'

// audit P2-9: editing an assignment must not, on a STALE save, cascade-delete a phase (and its
// student submissions) that was added concurrently AFTER the teacher's form loaded. Run against
// real SQL so the Phase→Submission FK cascade is exercised for real — the whole point is that it
// must NOT fire for a phase the edit never knew about.

const draft = (over: Partial<PhaseDraft> = {}): PhaseDraft => ({
  id: null, title: null, category: null, instructions: null, useBankSet: false,
  typedSentences: ['Hi'], openAt: null, dueAt: null,
  requireEyesClosed: false, requireText: false, requireAudio: true, requireVideo: false, requireHandwriting: false,
  graded: true, maxAttempts: 1, weight: 1, isFormalTest: false, freePractice: false, ...over,
})

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const student = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 's1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const assignment = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
  const phaseA = await p.phase.create({ data: { assignmentId: assignment.id, order: 1, requireAudio: true, graded: true, maxAttempts: 1 } })
  return { school, teacher, student, offering, assignment, phaseA }
}

describe('assignment concurrent edit (audit P2-9)', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('a stale save keeps a concurrently-added phase and its graded submissions', async () => {
    const p = db.prisma
    const d = await seed(p)
    // The teacher opened the edit form when the assignment had ONLY phase A.
    const known = [d.phaseA.id]

    // Concurrently (another tab / the 复习作业 builder) phase B is added and a student submits to it.
    const phaseB = await p.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireAudio: true, graded: true, maxAttempts: 1 } })
    const sub = await p.submission.create({ data: { assignmentId: d.assignment.id, phaseId: phaseB.id, studentId: d.student.id, attempt: 1, status: 'GRADED', finalScore: 90, videoKey: 'v' } })

    // The teacher saves their STALE form: it knows only phase A (keeps it), nothing about B.
    const res = await updateAssignment(p, d.school.id, d.teacher.id, 'TEACHER', d.assignment.id, { title: 'A (edited)', monthLabel: null }, [draft({ id: d.phaseA.id })], null, known)
    expect(res).toEqual({ ok: true })

    // Phase B and its graded submission MUST survive — not cascade-deleted by the stale save.
    expect(await p.phase.findUnique({ where: { id: phaseB.id } })).not.toBeNull()
    expect(await p.submission.findUnique({ where: { id: sub.id } })).toMatchObject({ finalScore: 90 })
    // Phase A is kept and the assignment meta updated.
    expect(await p.phase.findUnique({ where: { id: d.phaseA.id } })).not.toBeNull()
    expect(await p.assignment.findUniqueOrThrow({ where: { id: d.assignment.id } })).toMatchObject({ title: 'A (edited)' })
  })

  it('still deletes a phase the teacher genuinely removed (loaded it, then dropped it)', async () => {
    const p = db.prisma
    const d = await seed(p)
    const phaseB = await p.phase.create({ data: { assignmentId: d.assignment.id, order: 2, requireAudio: true, graded: true, maxAttempts: 1 } })
    // The form loaded BOTH phases, and the teacher removed B on purpose.
    const known = [d.phaseA.id, phaseB.id]

    const res = await updateAssignment(p, d.school.id, d.teacher.id, 'TEACHER', d.assignment.id, { title: 'A', monthLabel: null }, [draft({ id: d.phaseA.id })], null, known)
    expect(res).toEqual({ ok: true })

    expect(await p.phase.findUnique({ where: { id: phaseB.id } })).toBeNull() // intentionally removed
    expect(await p.phase.findUnique({ where: { id: d.phaseA.id } })).not.toBeNull()
  })
})
