import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { freshDb, type TestDb } from './harness'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as offeringRepo from '@/lib/repo/offerings'
import * as submissionRepo from '@/lib/repo/submissions'

// End-to-end proof of the multi-tenant / within-school IDOR boundary (#192) against a
// REAL database: a TEACHER may reach only their OWN offerings' resources by id, an
// admin the whole school, and nobody crosses schools. The unit tests assert the
// `where` shape; these assert the actual rows the real SQL returns.

async function seed(p: PrismaClient) {
  const s1 = await p.school.create({ data: { name: 'S1', code: 'S1' } })
  const s2 = await p.school.create({ data: { name: 'S2', code: 'S2' } })
  const mk = (role: 'TEACHER' | 'SCHOOL_ADMIN' | 'STUDENT', schoolId: number, no: string) =>
    p.user.create({ data: { role, schoolId, staffNo: role === 'STUDENT' ? null : no, studentNo: role === 'STUDENT' ? no : null, passwordHash: 'x' } })
  const teacherA = await mk('TEACHER', s1.id, 'A')
  const teacherB = await mk('TEACHER', s1.id, 'B')
  const admin = await mk('SCHOOL_ADMIN', s1.id, 'ADM')
  const teacherC = await mk('TEACHER', s2.id, 'C')
  const student = await mk('STUDENT', s1.id, 'stu1')
  const course = await p.course.create({ data: { schoolId: s1.id, name: 'Eng', code: 'E1' } })
  const cls1 = await p.classGroup.create({ data: { schoolId: s1.id, name: 'Class1' } })
  const cls2 = await p.classGroup.create({ data: { schoolId: s1.id, name: 'Class2' } })
  const offerA = await p.courseOffering.create({ data: { schoolId: s1.id, courseId: course.id, teacherId: teacherA.id, classId: cls1.id, year: '2025-2026', semester: '1' } })
  const offerB = await p.courseOffering.create({ data: { schoolId: s1.id, courseId: course.id, teacherId: teacherB.id, classId: cls2.id, year: '2025-2026', semester: '1' } })
  const asgA = await p.assignment.create({ data: { offeringId: offerA.id, title: 'Asg A' } })
  const subA = await p.submission.create({ data: { assignmentId: asgA.id, studentId: student.id, attempt: 1, status: 'UPLOADED' } })
  return { s1, s2, teacherA, teacherB, admin, teacherC, offerA, offerB, asgA, subA }
}

describe('within-school IDOR boundary (real SQL)', () => {
  let db: TestDb
  beforeEach(async () => { db = freshDb(); await db.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON') })
  afterEach(async () => { await db?.cleanup() })

  it('a TEACHER cannot read another teacher\'s assignment by id; the owner and admin can', async () => {
    const d = await seed(db.prisma)
    // Owner sees it.
    expect(await assignmentRepo.findForSchool(db.prisma, d.asgA.id, d.s1.id, d.teacherA.id, 'TEACHER')).not.toBeNull()
    // A different teacher in the SAME school cannot (the IDOR that #192 closed).
    expect(await assignmentRepo.findForSchool(db.prisma, d.asgA.id, d.s1.id, d.teacherB.id, 'TEACHER')).toBeNull()
    // A school admin sees any assignment in the school.
    expect(await assignmentRepo.findForSchool(db.prisma, d.asgA.id, d.s1.id, d.admin.id, 'SCHOOL_ADMIN')).not.toBeNull()
  })

  it('nobody crosses schools, even an admin', async () => {
    const d = await seed(db.prisma)
    expect(await assignmentRepo.findForSchool(db.prisma, d.asgA.id, d.s2.id, d.teacherC.id, 'TEACHER')).toBeNull()
    expect(await assignmentRepo.findForSchool(db.prisma, d.asgA.id, d.s2.id, d.teacherC.id, 'SCHOOL_ADMIN')).toBeNull()
  })

  it('offerings are teacher-scoped by id the same way', async () => {
    const d = await seed(db.prisma)
    expect(await offeringRepo.findForSchool(db.prisma, d.offerA.id, d.s1.id, d.teacherA.id, 'TEACHER')).not.toBeNull()
    expect(await offeringRepo.findForSchool(db.prisma, d.offerA.id, d.s1.id, d.teacherB.id, 'TEACHER')).toBeNull()
    expect(await offeringRepo.findForSchool(db.prisma, d.offerA.id, d.s1.id, d.admin.id, 'SCHOOL_ADMIN')).not.toBeNull()
  })

  it('a submission is reachable only through its owning teacher (or admin)', async () => {
    const d = await seed(db.prisma)
    expect(await submissionRepo.findForStaff(db.prisma, d.subA.id, d.s1.id, d.teacherA.id, 'TEACHER')).not.toBeNull()
    expect(await submissionRepo.findForStaff(db.prisma, d.subA.id, d.s1.id, d.teacherB.id, 'TEACHER')).toBeNull()
    expect(await submissionRepo.findForStaff(db.prisma, d.subA.id, d.s1.id, d.admin.id, 'SCHOOL_ADMIN')).not.toBeNull()
  })

  // The admin calibration query (#222/#224/#226) is also a tenant boundary: it must return
  // only THIS school's re-scored grades, only ones with BOTH scores, only within the
  // window — and carry each row's teacher. Proven here against real SQL, not a mock.
  it('listScorePairsForSchool: this school only, both-scored only, within the window, with teacher', async () => {
    const d = await seed(db.prisma)
    const p = db.prisma
    const now = Date.now()
    const recent = new Date(now - 10 * 86_400_000) // inside a 180-day window
    const old = new Date(now - 365 * 86_400_000) // outside it
    const since = new Date(now - 180 * 86_400_000)
    const student = d.subA.studentId

    // teacherA (offerA): two recent, both-scored grades
    await p.submission.create({ data: { assignmentId: d.asgA.id, studentId: student, attempt: 2, status: 'GRADED', aiScore: 70, teacherScore: 80, gradedAt: recent } })
    await p.submission.create({ data: { assignmentId: d.asgA.id, studentId: student, attempt: 3, status: 'GRADED', aiScore: 60, teacherScore: 65, gradedAt: recent } })
    // teacherB (offerB): one recent, both-scored
    const asgB = await p.assignment.create({ data: { offeringId: d.offerB.id, title: 'Asg B' } })
    await p.submission.create({ data: { assignmentId: asgB.id, studentId: student, attempt: 1, status: 'GRADED', aiScore: 90, teacherScore: 85, gradedAt: recent } })
    // EXCLUDED — graded before the window
    await p.submission.create({ data: { assignmentId: d.asgA.id, studentId: student, attempt: 4, status: 'GRADED', aiScore: 50, teacherScore: 55, gradedAt: old } })
    // EXCLUDED — AI score only, the teacher never re-scored
    await p.submission.create({ data: { assignmentId: d.asgA.id, studentId: student, attempt: 5, status: 'GRADED', aiScore: 77, gradedAt: recent } })
    // EXCLUDED — a different school (s2)
    const courseS2 = await p.course.create({ data: { schoolId: d.s2.id, name: 'Eng2', code: 'E2' } })
    const clsS2 = await p.classGroup.create({ data: { schoolId: d.s2.id, name: 'C-S2' } })
    const offerS2 = await p.courseOffering.create({ data: { schoolId: d.s2.id, courseId: courseS2.id, teacherId: d.teacherC.id, classId: clsS2.id, year: '2025-2026', semester: '1' } })
    const asgS2 = await p.assignment.create({ data: { offeringId: offerS2.id, title: 'Asg S2' } })
    const studentS2 = await p.user.create({ data: { role: 'STUDENT', schoolId: d.s2.id, studentNo: 'stuS2', passwordHash: 'x' } })
    await p.submission.create({ data: { assignmentId: asgS2.id, studentId: studentS2.id, attempt: 1, status: 'GRADED', aiScore: 40, teacherScore: 95, gradedAt: recent } })

    const rows = await submissionRepo.listScorePairsForSchool(p, d.s1.id, since)
    expect(rows).toHaveLength(3) // the 3 s1 recent both-scored pairs; old / ai-only / s2 all excluded
    expect(rows.some((r) => r.aiScore === 40 && r.teacherScore === 95)).toBe(false) // no cross-school leak

    const byTeacher = new Map<number, number>()
    for (const r of rows) {
      const tid = r.assignment.offering.teacherId
      byTeacher.set(tid, (byTeacher.get(tid) ?? 0) + 1)
    }
    expect(byTeacher.get(d.teacherA.id)).toBe(2)
    expect(byTeacher.get(d.teacherB.id)).toBe(1)
  })
})
