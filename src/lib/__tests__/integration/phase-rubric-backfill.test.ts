import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { setPhaseRubric } from '@/lib/domain/phase-rubric-backfill'
import type { PrismaClient } from '@prisma/client'

const TITLE = '期末考核：2025-2026-2'

// school+offering+assignment(TITLE),环节2=写作(writing),环节3=口语(speech)。环节3 上放一份
// 已评提交,验证落 rubric 只写 Phase、不碰 Submission / 已出分。
async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: TITLE } })
  const write = await p.phase.create({ data: { assignmentId: asg.id, order: 2, itemType: 'writing', requireText: true, requireVideo: false, requireEyesClosed: false, graded: true } })
  const speak = await p.phase.create({ data: { assignmentId: asg.id, order: 3, itemType: 'speech', requireVideo: true, requireText: false, requireEyesClosed: true, graded: true } })
  const student = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '01', passwordHash: 'x' } })
  const sub = await p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId: speak.id, studentId: student.id, attempt: 1, status: 'GRADED', videoKey: 'v', finalScore: 88 } })
  return { school, asg, write, speak, sub }
}

describe('setPhaseRubric (环节评分标准落地)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('dry-run 报当前值、零写入;apply 写 rubric+参照来源+合规;不碰 Submission / 已出分', async () => {
    const d = await seed(db.prisma)

    const dry = await setPhaseRubric(db.prisma, d.school.id, TITLE, 3, { rubric: 'R3', referenceSource: 'prior-text', complianceScoring: true }, false)
    if (!dry.ok) throw new Error(dry.error)
    expect(dry).toMatchObject({ applied: false, targets: 1, updated: 0 })
    expect(dry.perAssignment).toEqual([{ assignmentId: d.asg.id, itemType: 'speech', current: { rubric: null, referenceSource: null, complianceScoring: false } }])
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.speak.id } })).rubric).toBeNull()

    const r = await setPhaseRubric(db.prisma, d.school.id, TITLE, 3, { rubric: 'R3', referenceSource: 'prior-text', complianceScoring: true }, true)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, targets: 1, updated: 1 })
    const speak = await db.prisma.phase.findUniqueOrThrow({ where: { id: d.speak.id } })
    expect(speak).toMatchObject({ rubric: 'R3', referenceSource: 'prior-text', complianceScoring: true })
    // 环节2(不同序)绝不被动
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.write.id } })).rubric).toBeNull()
    // 已评提交一字未动
    const sub = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.sub.id } })
    expect(sub).toMatchObject({ status: 'GRADED', finalScore: 88 })
  })

  it('部分更新:只给 rubric 不动参照/合规;幂等重跑', async () => {
    const d = await seed(db.prisma)
    // 先全写
    await setPhaseRubric(db.prisma, d.school.id, TITLE, 3, { rubric: 'R3', referenceSource: 'prior-text', complianceScoring: true }, true)
    // 只改 rubric —— 参照/合规保持不变
    await setPhaseRubric(db.prisma, d.school.id, TITLE, 3, { rubric: 'R3-v2' }, true)
    const speak = await db.prisma.phase.findUniqueOrThrow({ where: { id: d.speak.id } })
    expect(speak).toMatchObject({ rubric: 'R3-v2', referenceSource: 'prior-text', complianceScoring: true })
    // 幂等重跑写同值
    const again = await setPhaseRubric(db.prisma, d.school.id, TITLE, 3, { rubric: 'R3-v2' }, true)
    expect(again.ok && again.updated).toBe(1)
    // referenceSource 传 null 可关
    await setPhaseRubric(db.prisma, d.school.id, TITLE, 3, { referenceSource: null }, true)
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.speak.id } })).referenceSource).toBeNull()
  })

  it('什么都不给 → 报错;标题/序号打错 → 报错,不静默空跑', async () => {
    const d = await seed(db.prisma)
    expect((await setPhaseRubric(db.prisma, d.school.id, TITLE, 3, {}, true)).ok).toBe(false)
    expect((await setPhaseRubric(db.prisma, d.school.id, '不存在', 3, { rubric: 'x' }, true)).ok).toBe(false)
    expect((await setPhaseRubric(db.prisma, d.school.id, TITLE, 9, { rubric: 'x' }, true)).ok).toBe(false)
  })
})
