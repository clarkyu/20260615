import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { createAssignments, type PhaseDraft } from '@/lib/domain/assignments'
import { findBatchSiblings, applyPhaseConfigToBatch } from '@/lib/repo/assignments'
import type { PrismaClient } from '@prisma/client'

// 「发一份作业 + 勾多个班」→ 每个班一份作业、共享一个 batchId；发布后改一次评阅配置能按
// batchId 找到兄弟作业并同步到勾选的班（同序环节），且只动勾选的目标、不越权。

const draft = (): PhaseDraft => ({
  id: null, title: null, category: null, instructions: null, useBankSet: false,
  typedSentences: ['Hi'], openAt: null, dueAt: null,
  requireEyesClosed: false, requireText: false, requireAudio: true, requireVideo: false, requireHandwriting: false,
  graded: true, maxAttempts: 1, isFormalTest: false, freePractice: false,
})

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const classes = []
  for (const i of [1, 2, 3]) classes.push(await p.classGroup.create({ data: { schoolId: school.id, name: `C${i}` } }))
  const offerings = []
  for (const c of classes) offerings.push(await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: c.id, year: 'Y', semester: '1' } }))
  return { school, teacher, offerings }
}

describe('publish batch + sync 评阅配置 to batch', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('one publish to 3 classes shares one batchId; siblings + targeted apply resolve by it', async () => {
    const d = await seed(db.prisma)
    const offeringIds = d.offerings.map((o) => o.id)
    const res = await createAssignments(db.prisma, d.school.id, d.teacher.id, 'TEACHER', { title: 'A', monthLabel: null }, [draft()], offeringIds, null, null)
    expect(res.ok).toBe(true)

    const assignments = await db.prisma.assignment.findMany({ orderBy: { offeringId: 'asc' }, include: { phases: true } })
    expect(assignments).toHaveLength(3)
    const batchIds = new Set(assignments.map((a) => a.batchId))
    expect(batchIds.size).toBe(1) // all three share one batch token
    expect([...batchIds][0]).toBeTruthy()

    const a1 = assignments[0]
    // The other two classes are the batch siblings.
    const sibs = await findBatchSiblings(db.prisma, a1.id, d.school.id, d.teacher.id, 'TEACHER')
    expect(sibs.map((s) => s.offeringId).sort((x, y) => x - y)).toEqual([d.offerings[1].id, d.offerings[2].id])
    expect(sibs.map((s) => s.className).sort()).toEqual(['C2', 'C3'])

    // Apply a1's phase config to ONLY class 2 → class 2's same-order phase updates; class 3 untouched.
    const n = await applyPhaseConfigToBatch(db.prisma, a1.phases[0].id, d.school.id, d.teacher.id, 'TEACHER', [d.offerings[1].id], { rubric: 'RX', defaultPerceptionModel: 'pm', defaultJudgeModel: 'jm' })
    expect(n).toBe(1)

    const a2phase = await db.prisma.phase.findFirst({ where: { assignmentId: assignments[1].id } })
    const a3phase = await db.prisma.phase.findFirst({ where: { assignmentId: assignments[2].id } })
    expect(a2phase).toMatchObject({ rubric: 'RX', defaultPerceptionModel: 'pm', defaultJudgeModel: 'jm' })
    expect(a3phase?.rubric).toBeNull() // not a target → unchanged
  })

  it('applyPhaseConfigToBatch is a no-op for an assignment with no batch (null batchId)', async () => {
    const d = await seed(db.prisma)
    // A standalone assignment (not created via the batch publish path) has batchId null.
    const solo = await db.prisma.assignment.create({ data: { offeringId: d.offerings[0].id, title: 'Solo' } })
    const phase = await db.prisma.phase.create({ data: { assignmentId: solo.id, order: 1, requireAudio: true, graded: true, maxAttempts: 1 } })
    const n = await applyPhaseConfigToBatch(db.prisma, phase.id, d.school.id, d.teacher.id, 'TEACHER', [d.offerings[1].id], { rubric: 'X', defaultPerceptionModel: null, defaultJudgeModel: null })
    expect(n).toBe(0)
  })
})
