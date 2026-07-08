import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { setSelectionMode } from '@/lib/domain/selection-backfill'
import type { PrismaClient } from '@prisma/client'

const TITLE = '期末考核：2025-2026-2'

// school+offering+assignment(TITLE),环节1=纯选择(requireChoice,无答案键)= 选题目标;
// 环节2=有答案键的单选题(客观判分)——绝不能被误标。环节1 上放一份学生选择,验证只写 Phase、不碰 Submission。
async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: TITLE } })
  const choice = await p.phase.create({ data: { assignmentId: asg.id, order: 1, requireChoice: true, requireText: false, requireVideo: false, requireEyesClosed: false, itemType: 'objective', choicesJson: '["题目1","题目2"]', graded: false, maxAttempts: 3 } })
  const quiz = await p.phase.create({ data: { assignmentId: asg.id, order: 2, requireChoice: true, requireText: false, requireVideo: false, requireEyesClosed: false, itemType: 'objective', choicesJson: '["A","B"]', correctChoice: 'A', graded: true, maxAttempts: 1 } })
  const student = await p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: '01', passwordHash: 'x' } })
  const sub = await p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId: choice.id, studentId: student.id, attempt: 1, status: 'UPLOADED', recitedText: '题目1' } })
  return { school, asg, choice, quiz, sub }
}

describe('setSelectionMode (选题落地)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('dry-run 报当前 mode、零写入;apply 只标环节1、不碰有答案键的环节2,也不碰 Submission', async () => {
    const d = await seed(db.prisma)

    const dry = await setSelectionMode(db.prisma, d.school.id, TITLE, 1, 'theme', false)
    if (!dry.ok) throw new Error(dry.error)
    expect(dry).toMatchObject({ applied: false, targets: 1, updated: 0 })
    expect(dry.perAssignment).toEqual([{ assignmentId: d.asg.id, current: null }])
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.choice.id } })).selectionMode).toBeNull()

    const r = await setSelectionMode(db.prisma, d.school.id, TITLE, 1, 'theme', true)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, targets: 1, updated: 1 })
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.choice.id } })).selectionMode).toBe('theme')
    // 有答案键的环节2(客观判分题)绝不被标
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.quiz.id } })).selectionMode).toBeNull()
    // Submission 一字未动(选择/状态原样)
    const sub = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.sub.id } })
    expect(sub.recitedText).toBe('题目1')
    expect(sub.status).toBe('UPLOADED')
  })

  it('branch 可标;poll 落回 null(民调);幂等重跑', async () => {
    const d = await seed(db.prisma)
    await setSelectionMode(db.prisma, d.school.id, TITLE, 1, 'branch', true)
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.choice.id } })).selectionMode).toBe('branch')
    // 幂等重跑
    const again = await setSelectionMode(db.prisma, d.school.id, TITLE, 1, 'branch', true)
    expect(again.ok && again.updated).toBe(1)
    // poll → null
    await setSelectionMode(db.prisma, d.school.id, TITLE, 1, 'poll', true)
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.choice.id } })).selectionMode).toBeNull()
  })

  it('标题/序号打错 → 报错,不静默空跑', async () => {
    const d = await seed(db.prisma)
    expect((await setSelectionMode(db.prisma, d.school.id, '不存在', 1, 'theme', true)).ok).toBe(false)
    expect((await setSelectionMode(db.prisma, d.school.id, TITLE, 9, 'theme', true)).ok).toBe(false)
  })
})
