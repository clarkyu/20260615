import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { createAssignments, type PhaseDraft } from '@/lib/domain/assignments'
import { findSyncSiblings, applyPhaseConfigToSiblings } from '@/lib/repo/assignments'
import type { PrismaClient } from '@prisma/client'

// 「设一次评阅配置 → 同步到其它班」的服务端保证:兄弟作业的识别(同一次发布的 batchId、
// 或已发布的同名同课程作业)+ 按显式作业 id 同步同序环节 + 本人 scope(不越权)。

const draft = (): PhaseDraft => ({
  id: null, title: null, category: null, instructions: null, useBankSet: false,
  typedSentences: ['Hi'], openAt: null, dueAt: null,
  requireEyesClosed: false, requireText: false, requireAudio: true, requireVideo: false, requireHandwriting: false,
  graded: true, maxAttempts: 1, weight: 1, isFormalTest: false, freePractice: false,
})

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const classes = []
  for (const i of [1, 2, 3]) classes.push(await p.classGroup.create({ data: { schoolId: school.id, name: `C${i}` } }))
  const offerings = []
  for (const c of classes) offerings.push(await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: c.id, year: 'Y', semester: '1' } }))
  return { school, teacher, course, offerings }
}

describe('sync 评阅配置 to sibling classes', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('one publish to 3 classes: findSyncSiblings lists the other two; apply targets by assignment id', async () => {
    const d = await seed(db.prisma)
    const res = await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', { title: 'A', monthLabel: null }, [draft()], d.offerings.map((o) => o.id), null, null)
    expect(res.ok).toBe(true)

    const assignments = await db.prisma.assignment.findMany({ orderBy: { offeringId: 'asc' }, include: { phases: true } })
    expect(assignments).toHaveLength(3)
    expect(new Set(assignments.map((a) => a.batchId)).size).toBe(1) // shared batch token

    const a1 = assignments[0]
    const sibs = await findSyncSiblings(db.prisma, a1.id, d.school.id, d.teacher.id, 'TEACHER')
    expect(sibs.map((s) => s.className)).toEqual(['C2', 'C3'])
    expect(sibs.map((s) => s.assignmentId).sort((x, y) => x - y)).toEqual([assignments[1].id, assignments[2].id])

    // Apply a1's phase config to ONLY class 2's assignment → its same-order phase updates; class 3 untouched.
    const n = await applyPhaseConfigToSiblings(db.prisma, a1.phases[0].id, d.school.id, d.teacher.id, 'TEACHER', [assignments[1].id], { rubric: 'RX', defaultPerceptionModel: 'pm', defaultJudgeModel: 'jm' })
    expect(n).toBe(1)
    expect(await db.prisma.phase.findFirst({ where: { assignmentId: assignments[1].id } })).toMatchObject({ rubric: 'RX', defaultPerceptionModel: 'pm', defaultJudgeModel: 'jm' })
    expect((await db.prisma.phase.findFirst({ where: { assignmentId: assignments[2].id } }))?.rubric).toBeNull()
  })

  it('already-published (legacy, no batchId) same-name assignments in other classes are found + syncable', async () => {
    const d = await seed(db.prisma)
    // Two INDEPENDENT assignments (batchId null), same title + course, in class 1 and class 2.
    const s1 = await db.prisma.assignment.create({ data: { offeringId: d.offerings[0].id, title: 'Unit 3' } })
    await db.prisma.phase.create({ data: { assignmentId: s1.id, order: 1, requireAudio: true, graded: true, maxAttempts: 1 } })
    const s2 = await db.prisma.assignment.create({ data: { offeringId: d.offerings[1].id, title: 'Unit 3' } })
    await db.prisma.phase.create({ data: { assignmentId: s2.id, order: 1, requireAudio: true, graded: true, maxAttempts: 1 } })

    const sibs = await findSyncSiblings(db.prisma, s1.id, d.school.id, d.teacher.id, 'TEACHER')
    expect(sibs).toHaveLength(1)
    expect(sibs[0]).toMatchObject({ assignmentId: s2.id, className: 'C2' })

    const s1phase = await db.prisma.phase.findFirstOrThrow({ where: { assignmentId: s1.id } })
    const n = await applyPhaseConfigToSiblings(db.prisma, s1phase.id, d.school.id, d.teacher.id, 'TEACHER', [s2.id], { rubric: 'LX', defaultPerceptionModel: null, defaultJudgeModel: null })
    expect(n).toBe(1)
    expect((await db.prisma.phase.findFirst({ where: { assignmentId: s2.id } }))?.rubric).toBe('LX')
  })

  it('publishing twice with the SAME client batchId is idempotent — no duplicate assignments (audit P2-9)', async () => {
    const d = await seed(db.prisma)
    const ids = d.offerings.map((o) => o.id)
    const meta = { title: 'A', monthLabel: null }
    const batchId = 'fixed-batch-123'
    const r1 = await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', meta, [draft()], ids, null, null, batchId)
    const r2 = await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', meta, [draft()], ids, null, null, batchId) // double-click / retry
    expect(r1.ok && r2.ok).toBe(true)
    // Exactly one assignment per class (3), NOT six — the retry created nothing.
    expect(await db.prisma.assignment.count()).toBe(3)
    expect(new Set((await db.prisma.assignment.findMany({ select: { batchId: true } })).map((a) => a.batchId))).toEqual(new Set([batchId]))
  })

  it('two publishes WITHOUT a client batchId stay independent (server mints a fresh batch each time)', async () => {
    const d = await seed(db.prisma)
    const ids = d.offerings.map((o) => o.id)
    const meta = { title: 'A', monthLabel: null }
    await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', meta, [draft()], ids, null, null)
    await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', meta, [draft()], ids, null, null)
    expect(await db.prisma.assignment.count()).toBe(6) // no idempotency key → two independent publishes
  })

  it('rejects one publish spanning offerings of two DIFFERENT courses, creating nothing (复查 R10)', async () => {
    const d = await seed(db.prisma)
    // A second course taught by the same teacher — its offering must not mix into an E-course publish.
    const math = await db.prisma.course.create({ data: { schoolId: d.school.id, name: 'M', code: 'M' } })
    const mathOffering = await db.prisma.courseOffering.create({ data: { schoolId: d.school.id, courseId: math.id, teacherId: d.teacher.id, classId: (await db.prisma.classGroup.create({ data: { schoolId: d.school.id, name: 'C4' } })).id, year: 'Y', semester: '1' } })

    const res = await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', { title: 'X', monthLabel: null }, [draft()], [d.offerings[0].id, mathOffering.id], null, null)
    expect(res).toEqual({ ok: false, error: 'err.mixedCoursePublish' })
    expect(await db.prisma.assignment.count()).toBe(0)

    // Same-course multi-class publish still goes through untouched.
    const ok = await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', { title: 'X', monthLabel: null }, [draft()], [d.offerings[0].id, d.offerings[1].id], null, null)
    expect(ok.ok).toBe(true)
    expect(await db.prisma.assignment.count()).toBe(2)
  })

  it('persists the teacher-set per-phase weight through publish (feature ①)', async () => {
    const d = await seed(db.prisma)
    await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', { title: 'W', monthLabel: null }, [{ ...draft(), weight: 3 }], [d.offerings[0].id], null, null)
    const phase = await db.prisma.phase.findFirstOrThrow({ where: { assignment: { title: 'W' } } })
    expect(phase.weight).toBe(3)
  })

  it('is scoped to the teacher: cannot find or sync to another teacher’s assignment', async () => {
    const d = await seed(db.prisma)
    const other = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: d.school.id, staffNo: 'T2', passwordHash: 'x' } })
    const otherOffering = await db.prisma.courseOffering.create({ data: { schoolId: d.school.id, courseId: d.course.id, teacherId: other.id, classId: (await db.prisma.classGroup.create({ data: { schoolId: d.school.id, name: 'C9' } })).id, year: 'Y', semester: '1' } })
    // T1's assignment + T2's same-title assignment in the same course.
    const mine = await db.prisma.assignment.create({ data: { offeringId: d.offerings[0].id, title: 'Shared' } })
    await db.prisma.phase.create({ data: { assignmentId: mine.id, order: 1, requireAudio: true, graded: true, maxAttempts: 1 } })
    const theirs = await db.prisma.assignment.create({ data: { offeringId: otherOffering.id, title: 'Shared' } })
    await db.prisma.phase.create({ data: { assignmentId: theirs.id, order: 1, requireAudio: true, graded: true, maxAttempts: 1 } })

    // T2's assignment is NOT a candidate for T1 (scoped out), and applying to it is a no-op.
    const sibs = await findSyncSiblings(db.prisma, mine.id, d.school.id, d.teacher.id, 'TEACHER')
    expect(sibs.find((s) => s.assignmentId === theirs.id)).toBeUndefined()

    const minePhase = await db.prisma.phase.findFirstOrThrow({ where: { assignmentId: mine.id } })
    const n = await applyPhaseConfigToSiblings(db.prisma, minePhase.id, d.school.id, d.teacher.id, 'TEACHER', [theirs.id], { rubric: 'HACK', defaultPerceptionModel: null, defaultJudgeModel: null })
    expect(n).toBe(0)
    expect((await db.prisma.phase.findFirst({ where: { assignmentId: theirs.id } }))?.rubric).toBeNull()
  })
})
