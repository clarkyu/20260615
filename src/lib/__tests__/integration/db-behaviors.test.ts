import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { freshDb, type TestDb } from './harness'
import * as classRepo from '@/lib/repo/classes'
import * as submissionRepo from '@/lib/repo/submissions'

// Behaviours only a REAL database can prove: ON DELETE CASCADE, and the raw-SQL
// `acceptAiForAssignment` (deliberately not unit-tested — mocking raw SQL only
// snapshots the template; a real engine actually runs the COALESCE + status guards).

async function assignmentWithSubs(p: PrismaClient, subs: { no: string; status: string; needsReview: boolean; aiScore: number | null; teacherScore: number | null }[]) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'C', code: 'C' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'K' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
  const ids: Record<string, number> = {}
  for (const s of subs) {
    const stu = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: s.no, passwordHash: 'x' } })
    const sub = await p.submission.create({ data: { assignmentId: asg.id, studentId: stu.id, attempt: 1, status: s.status as never, needsReview: s.needsReview, aiScore: s.aiScore, teacherScore: s.teacherScore } })
    ids[s.no] = sub.id
  }
  return { asg, ids, teacherId: teacher.id }
}

describe('real cascade + raw SQL behaviours', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('deleteWithStudents cascades memberships and deletes only the orphaned student', async () => {
    const p = db.prisma
    const school = await p.school.create({ data: { name: 'S', code: 'S' } })
    const c1 = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
    const c2 = await p.classGroup.create({ data: { schoolId: school.id, name: 'C2' } })
    const both = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 'both', passwordHash: 'x' } })
    const only1 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: 'only1', passwordHash: 'x' } })
    await p.studentClass.create({ data: { studentId: both.id, classId: c1.id } })
    await p.studentClass.create({ data: { studentId: both.id, classId: c2.id } })
    await p.studentClass.create({ data: { studentId: only1.id, classId: c1.id } })

    expect(await classRepo.deleteWithStudents(p, c1.id, school.id)).toBe(true)

    expect(await p.classGroup.findUnique({ where: { id: c1.id } })).toBeNull()
    // The cross-class student is kept and still in C2 (their C1 membership cascaded away).
    expect(await p.user.findUnique({ where: { id: both.id } })).not.toBeNull()
    expect(await p.studentClass.count({ where: { studentId: both.id } })).toBe(1)
    // The student who was only in C1 is gone (orphan cleanup).
    expect(await p.user.findUnique({ where: { id: only1.id } })).toBeNull()
  })

  it('classDeletionImpact counts the offerings/assignments/non-DRAFT submissions the cascade would destroy (tenant-scoped)', async () => {
    const p = db.prisma
    const { asg } = await assignmentWithSubs(p, [
      { no: 'a', status: 'GRADED', needsReview: false, aiScore: 80, teacherScore: null },
      { no: 'b', status: 'UPLOADED', needsReview: true, aiScore: null, teacherScore: null },
      { no: 'c', status: 'DRAFT', needsReview: false, aiScore: null, teacherScore: null }, // excluded (not yet submitted)
    ])
    const off = (await p.courseOffering.findFirst({ where: { assignments: { some: { id: asg.id } } } }))!
    expect(await classRepo.classDeletionImpact(p, off.classId, off.schoolId)).toEqual({ offerings: 1, assignments: 1, submissions: 2 })
    // Wrong school → sees nothing (the ?? -1 sentinel / tenant scope holds).
    expect(await classRepo.classDeletionImpact(p, off.classId, -999)).toEqual({ offerings: 0, assignments: 0, submissions: 0 })
  })

  it('acceptAiForAssignment finalizes only AI-scored rows needing review, never clobbering a teacher score or a flagged row', async () => {
    const p = db.prisma
    const { asg, ids, teacherId } = await assignmentWithSubs(p, [
      { no: 'ai', status: 'GRADED', needsReview: true, aiScore: 80, teacherScore: null }, // → finalScore 80
      { no: 'teacher', status: 'GRADED', needsReview: true, aiScore: 80, teacherScore: 90 }, // → keeps 90
      { no: 'noai', status: 'GRADED', needsReview: true, aiScore: null, teacherScore: null }, // → untouched (no AI score)
      { no: 'flagged', status: 'FLAGGED', needsReview: true, aiScore: 70, teacherScore: null }, // → untouched (flagged)
      { no: 'done', status: 'GRADED', needsReview: false, aiScore: 60, teacherScore: null }, // → untouched (already reviewed)
    ])

    const affected = await submissionRepo.acceptAiForAssignment(p, asg.id, teacherId, new Date())
    expect(affected).toBe(2) // only 'ai' and 'teacher' match the WHERE

    const get = async (no: string) => p.submission.findUnique({ where: { id: ids[no] } })
    expect(await get('ai')).toMatchObject({ finalScore: 80, status: 'GRADED', needsReview: false, gradedById: teacherId })
    expect(await get('teacher')).toMatchObject({ finalScore: 90, needsReview: false }) // COALESCE(teacherScore, aiScore)
    expect(await get('noai')).toMatchObject({ finalScore: null, needsReview: true })
    expect(await get('flagged')).toMatchObject({ status: 'FLAGGED', needsReview: true })
    expect(await get('done')).toMatchObject({ finalScore: null, needsReview: false })
  })

  it('acceptAiForPhaseRows finalizes pending-review AI rows INCLUDING flagged, phase-scoped, never clobbering a teacher score', async () => {
    const p = db.prisma
    const school = await p.school.create({ data: { name: 'S', code: 'S' } })
    const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T', passwordHash: 'x' } })
    const course = await p.course.create({ data: { schoolId: school.id, name: 'C', code: 'C' } })
    const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'K' } })
    const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
    const asg = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
    const phase = await p.phase.create({ data: { assignmentId: asg.id, order: 4 } })
    const other = await p.phase.create({ data: { assignmentId: asg.id, order: 3 } })

    const mk = async (no: string, phaseId: number, s: { status: string; needsReview: boolean; aiScore: number | null; teacherScore: number | null }) => {
      const stu = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: no, passwordHash: 'x' } })
      const sub = await p.submission.create({ data: { assignmentId: asg.id, phaseId, studentId: stu.id, attempt: 1, status: s.status as never, needsReview: s.needsReview, aiScore: s.aiScore, teacherScore: s.teacherScore } })
      return sub.id
    }
    const ids = {
      flagged: await mk('flagged', phase.id, { status: 'FLAGGED', needsReview: true, aiScore: 70, teacherScore: null }), // → finalized to 70 (the new behavior)
      lowconf: await mk('lowconf', phase.id, { status: 'GRADED', needsReview: true, aiScore: 55, teacherScore: null }), // → finalized to 55
      teacher: await mk('teacher', phase.id, { status: 'FLAGGED', needsReview: true, aiScore: 70, teacherScore: 88 }), // → keeps 88 (COALESCE)
      noai: await mk('noai', phase.id, { status: 'FLAGGED', needsReview: true, aiScore: null, teacherScore: null }), // → untouched (no AI score)
      done: await mk('done', phase.id, { status: 'GRADED', needsReview: false, aiScore: 60, teacherScore: null }), // → untouched (already reviewed)
      otherPhase: await mk('otherPhase', other.id, { status: 'FLAGGED', needsReview: true, aiScore: 42, teacherScore: null }), // → untouched (different phase)
    }

    const affected = await submissionRepo.acceptAiForPhaseRows(p, [phase.id], new Date())
    expect(affected).toBe(3) // flagged + lowconf + teacher

    const get = async (k: keyof typeof ids) => p.submission.findUnique({ where: { id: ids[k] } })
    expect(await get('flagged')).toMatchObject({ finalScore: 70, status: 'GRADED', needsReview: false })
    expect(await get('lowconf')).toMatchObject({ finalScore: 55, status: 'GRADED', needsReview: false })
    expect(await get('teacher')).toMatchObject({ finalScore: 88, status: 'GRADED', needsReview: false }) // teacher score wins
    expect(await get('noai')).toMatchObject({ finalScore: null, status: 'FLAGGED', needsReview: true })
    expect(await get('done')).toMatchObject({ finalScore: null, status: 'GRADED', needsReview: false })
    expect(await get('otherPhase')).toMatchObject({ finalScore: null, status: 'FLAGGED', needsReview: true }) // phase scope holds
  })

  it('order-uniqueness: rejects a duplicate (chunkSetId, order) chunk (audit P2-3)', async () => {
    const p = db.prisma
    const set = await p.chunkSet.create({ data: { name: 'S' } })
    await p.chunk.create({ data: { chunkSetId: set.id, order: 1, english: 'a' } })
    await expect(p.chunk.create({ data: { chunkSetId: set.id, order: 1, english: 'b' } })).rejects.toThrow()
    await expect(p.chunk.create({ data: { chunkSetId: set.id, order: 2, english: 'c' } })).resolves.toBeTruthy()
  })

  it('order-uniqueness: rejects a duplicate (phaseId, order) sentence but ALLOWS phase-less duplicates (NULL distinct)', async () => {
    const p = db.prisma
    const school = await p.school.create({ data: { name: 'S', code: 'S' } })
    const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T', passwordHash: 'x' } })
    const course = await p.course.create({ data: { schoolId: school.id, name: 'C', code: 'C' } })
    const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'K' } })
    const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '1' } })
    const asg = await p.assignment.create({ data: { offeringId: offering.id, title: 'A' } })
    const phase = await p.phase.create({ data: { assignmentId: asg.id, order: 1 } })
    await p.sentence.create({ data: { assignmentId: asg.id, phaseId: phase.id, order: 1, text: 'x' } })
    await expect(p.sentence.create({ data: { assignmentId: asg.id, phaseId: phase.id, order: 1, text: 'y' } })).rejects.toThrow()
    // legacy phase-less sentences with the same order are fine — SQLite treats NULL as distinct,
    // so the unique index behaves like a partial index over non-null phaseId.
    await p.sentence.create({ data: { assignmentId: asg.id, phaseId: null, order: 1, text: 'legacy1' } })
    await expect(p.sentence.create({ data: { assignmentId: asg.id, phaseId: null, order: 1, text: 'legacy2' } })).resolves.toBeTruthy()
  })
})
