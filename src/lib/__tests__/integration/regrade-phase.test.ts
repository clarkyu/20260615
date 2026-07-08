import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { regradePhase } from '@/lib/domain/grading-backfill'
import type { PrismaClient } from '@prisma/client'

const TITLE = '期末考核：2025-2026-2'

// school+offering+assignment(TITLE)。环节3=speech(整段视频背诵),放几份已定稿提交:
// 一份 GRADED 带 aiResult(含 perception,perceptionJson 已被清空)、一份老师改分(不该动)。
async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: TITLE } })
  const write = await p.phase.create({ data: { assignmentId: asg.id, order: 2, itemType: 'writing', requireText: true, requireVideo: false, graded: true } })
  const speak = await p.phase.create({ data: { assignmentId: asg.id, order: 3, itemType: 'speech', requireVideo: true, requireText: false, requireEyesClosed: true, referenceSource: 'prior-text', graded: true } })
  const s1 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '01', passwordHash: 'x' } })
  const s2 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '02', passwordHash: 'x' } })
  const s3 = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '03', passwordHash: 'x' } })
  const aiResult = JSON.stringify({ perceptionModel: 'pm', perception: { transcript: 'hello', perSentence: [], observations: {} }, judge: { score: 80 } })
  // ① AI 定稿、perceptionJson 已清空(#400) → 重评目标,应恢复缓存
  const graded = await p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId: speak.id, studentId: s1.id, attempt: 1, status: 'GRADED', videoKey: 'v1', aiScore: 80, finalScore: 80, aiResult, perceptionJson: null } })
  // ② FLAGGED、也带 aiResult → 也是目标
  const flagged = await p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId: speak.id, studentId: s2.id, attempt: 1, status: 'FLAGGED', videoKey: 'v2', aiScore: 60, finalScore: 60, aiResult, perceptionJson: null } })
  // ③ 老师改分(teacherScore 非空) → 绝不动
  const teacherGraded = await p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId: speak.id, studentId: s3.id, attempt: 1, status: 'GRADED', videoKey: 'v3', aiScore: 70, teacherScore: 95, finalScore: 95, aiResult, perceptionJson: null } })
  return { school, asg, write, speak, graded, flagged, teacherGraded }
}

describe('regradePhase (廉价重评)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('dry-run 报总盘子、零写入(不含老师改分的行)', async () => {
    const d = await seed(db.prisma)
    const dry = await regradePhase(db.prisma, d.school.id, TITLE, 3, false)
    if (!dry.ok) throw new Error(dry.error)
    expect(dry).toMatchObject({ applied: false, total: 2, scanned: 2, more: false, restored: 0, requeued: 0, kind: 'submission' })
    // 零写入:状态/缓存原样
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.graded.id } }))).toMatchObject({ status: 'GRADED', perceptionJson: null })
  })

  it('apply:恢复感知缓存 + 置回 UPLOADED + 入队;老师改分的一字不动', async () => {
    const d = await seed(db.prisma)
    const r = await regradePhase(db.prisma, d.school.id, TITLE, 3, true)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, total: 2, scanned: 2, restored: 2, kind: 'submission' })
    expect(r.requeued).toBe(2)

    // ① GRADED → UPLOADED,perceptionJson 从 aiResult 恢复(可被重评复用)
    const g = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.graded.id } })
    expect(g.status).toBe('UPLOADED')
    expect(JSON.parse(g.perceptionJson!)).toEqual({ perceptionModel: 'pm', perception: { transcript: 'hello', perSentence: [], observations: {} } })
    // aiScore/finalScore 不动(由重评落库时覆盖)
    expect(g).toMatchObject({ aiScore: 80, finalScore: 80 })
    // 入队了一份 submission 评阅任务
    expect(await db.prisma.gradingJob.findFirst({ where: { submissionId: d.graded.id } })).toMatchObject({ kind: 'submission', status: 'PENDING' })

    // ② FLAGGED 同样处理
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.flagged.id } })).status).toBe('UPLOADED')

    // ③ 老师改分:状态/分/缓存全不动,也没入队
    const t = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.teacherGraded.id } })
    expect(t).toMatchObject({ status: 'GRADED', teacherScore: 95, finalScore: 95, perceptionJson: null })
    expect(await db.prisma.gradingJob.findFirst({ where: { submissionId: d.teacherGraded.id } })).toBeNull()
  })

  it('writing 环节:重判为 writing、无感知可恢复(restored=0)', async () => {
    const d = await seed(db.prisma)
    // 给环节2 放一份 AI 定稿的写作提交(writing 没有 perception)
    const s = await db.prisma.user.create({ data: { role: 'STUDENT', schoolId: d.school.id, studentNo: '09', passwordHash: 'x' } })
    const w = await db.prisma.submission.create({ data: { assignmentId: d.asg.id, offeringId: (await db.prisma.assignment.findUniqueOrThrow({ where: { id: d.asg.id }, select: { offeringId: true } })).offeringId, phaseId: d.write.id, studentId: s.id, attempt: 1, status: 'GRADED', recitedText: 'My essay.', aiScore: 88, finalScore: 88, aiResult: JSON.stringify({ judgeModel: 'jm', judge: { score: 88 } }), perceptionJson: null } })
    const r = await regradePhase(db.prisma, d.school.id, TITLE, 2, true)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, total: 1, restored: 0, kind: 'writing' })
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: w.id } })).status).toBe('UPLOADED')
    expect(await db.prisma.gradingJob.findFirst({ where: { submissionId: w.id } })).toMatchObject({ kind: 'writing', status: 'PENDING' })
  })

  it('没有目标 / 环节不存在 → 报错,不静默空跑', async () => {
    const d = await seed(db.prisma)
    // 环节4 不存在
    expect((await regradePhase(db.prisma, d.school.id, TITLE, 4, true)).ok).toBe(false)
    // 错标题
    expect((await regradePhase(db.prisma, d.school.id, '不存在', 3, true)).ok).toBe(false)
  })
})
