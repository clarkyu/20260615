import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { backfillWritingGrading } from '@/lib/domain/grading-backfill'
import type { PrismaClient } from '@prisma/client'

// 评阅补登(维护):写作类提交补建 writing 任务 + 纯投票环节清幽灵复核。
// 关键约定:dry-run 零写入;只碰 UPLOADED/FLAGGED、无 AI 分、文本非空的写作行;
// 有答案键的客观题 needsReview 是「答案键缺失转人工」的正路,绝不误清;按学校钉租户。

vi.mock('@/lib/cf', () => ({ runAfterResponse: () => {} })) // 后台排空踢腿在测试里不跑

const TITLE = '期末考核：2025-2026-2'

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: TITLE, requireText: true } })
  const writing = await p.phase.create({ data: { assignmentId: asg.id, order: 2, requireText: true, requireVideo: false, requireEyesClosed: false, itemType: 'writing', graded: true, maxAttempts: 3 } })
  const poll = await p.phase.create({ data: { assignmentId: asg.id, order: 1, requireChoice: true, requireText: false, requireVideo: false, requireEyesClosed: false, choicesJson: '["A","B"]', itemType: 'objective', graded: false, maxAttempts: 3 } })
  const quiz = await p.phase.create({ data: { assignmentId: asg.id, order: 3, requireChoice: true, requireText: false, requireVideo: false, requireEyesClosed: false, choicesJson: '["A","B"]', correctChoice: 'A', itemType: 'objective', graded: true, maxAttempts: 1 } })

  const student = async (no: string) => p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: no, passwordHash: 'x' } })
  const sub = (studentId: number, phaseId: number, over: object = {}) =>
    p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId, studentId, attempt: 1, status: 'UPLOADED', ...over } })

  const s = await Promise.all(['01', '02', '03', '04', '05', '06', '07'].map(student))
  const wCandidate = await sub(s[0].id, writing.id, { recitedText: '默写内容甲', needsReview: true })
  const wFlagged = await sub(s[1].id, writing.id, { recitedText: '默写内容乙', status: 'FLAGGED', needsReview: true })
  const wScored = await sub(s[2].id, writing.id, { recitedText: '已评过', aiScore: 80, needsReview: true })
  const wEmpty = await sub(s[3].id, writing.id, { recitedText: '' })
  const wGraded = await sub(s[4].id, writing.id, { recitedText: '老师已定稿', status: 'GRADED', finalScore: 90 })
  const ghostPoll = await sub(s[5].id, poll.id, { recitedText: 'A', needsReview: true }) // 幽灵:纯投票不复核
  const quizReview = await sub(s[6].id, quiz.id, { recitedText: 'A', needsReview: true }) // 正路:有答案键,不许清
  return { school, asg, writing, poll, quiz, wCandidate, wFlagged, wScored, wEmpty, wGraded, ghostPoll, quizReview }
}

describe('backfillWritingGrading', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('dry-run reports candidates + ghosts and writes nothing', async () => {
    const d = await seed(db.prisma)
    const r = await backfillWritingGrading(db.prisma, d.school.id, TITLE, false)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: false, writingCandidates: 2, jobsCreated: 0, jobsReset: 0, ghostReview: 1 })
    expect(r.perAssignment).toEqual([{ assignmentId: d.asg.id, count: 2 }])
    expect(await db.prisma.gradingJob.count()).toBe(0)
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.ghostPoll.id } })).needsReview).toBe(true)
  })

  it('apply enqueues ONLY the eligible writing rows and clears ONLY pure-poll ghosts; idempotent rerun resets', async () => {
    const d = await seed(db.prisma)
    const r = await backfillWritingGrading(db.prisma, d.school.id, TITLE, true)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, writingCandidates: 2, jobsCreated: 2, jobsReset: 0, ghostReview: 1 })

    const jobs = await db.prisma.gradingJob.findMany({ orderBy: { submissionId: 'asc' } })
    expect(jobs.map((j) => j.submissionId)).toEqual([d.wCandidate.id, d.wFlagged.id])
    for (const j of jobs) expect(j).toMatchObject({ kind: 'writing', status: 'PENDING', attempts: 0 })

    // 幽灵清了;有答案键的 needsReview(答案键缺失转人工的正路)原样保留。
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.ghostPoll.id } })).needsReview).toBe(false)
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.quizReview.id } })).needsReview).toBe(true)
    // 已评/空文本/老师定稿的行没有任务。
    for (const id of [d.wScored.id, d.wEmpty.id, d.wGraded.id]) {
      expect(await db.prisma.gradingJob.findUnique({ where: { submissionId: id } })).toBeNull()
    }

    // 重跑:同一批候选重置为 PENDING(不重复建),幽灵已清为 0。
    const again = await backfillWritingGrading(db.prisma, d.school.id, TITLE, true)
    if (!again.ok) throw new Error(again.error)
    expect(again).toMatchObject({ jobsCreated: 0, jobsReset: 2, ghostReview: 0 })
    expect(await db.prisma.gradingJob.count()).toBe(2)
  })

  it('is pinned to the school: a same-title assignment in another school is untouched', async () => {
    const d = await seed(db.prisma)
    const other = await db.prisma.school.create({ data: { name: 'S2', code: 'S2' } })
    const t2 = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: other.id, staffNo: 'T2', passwordHash: 'x' } })
    const c2 = await db.prisma.course.create({ data: { schoolId: other.id, name: 'E', code: 'E2' } })
    const cls2 = await db.prisma.classGroup.create({ data: { schoolId: other.id, name: 'C9' } })
    const off2 = await db.prisma.courseOffering.create({ data: { schoolId: other.id, courseId: c2.id, teacherId: t2.id, classId: cls2.id, year: 'Y', semester: '2' } })
    const asg2 = await db.prisma.assignment.create({ data: { offeringId: off2.id, title: TITLE, requireText: true } })
    const ph2 = await db.prisma.phase.create({ data: { assignmentId: asg2.id, order: 1, requireText: true, requireVideo: false, requireEyesClosed: false, itemType: 'writing', graded: true, maxAttempts: 1 } })
    const st2 = await db.prisma.user.create({ data: { role: 'STUDENT', schoolId: other.id, studentNo: 'X1', passwordHash: 'x' } })
    const foreign = await db.prisma.submission.create({ data: { assignmentId: asg2.id, offeringId: off2.id, phaseId: ph2.id, studentId: st2.id, attempt: 1, status: 'UPLOADED', recitedText: '别校内容' } })

    const r = await backfillWritingGrading(db.prisma, d.school.id, TITLE, true)
    if (!r.ok) throw new Error(r.error)
    expect(r.ok && r.writingCandidates).toBe(2) // 只有本校两份
    expect(await db.prisma.gradingJob.findUnique({ where: { submissionId: foreign.id } })).toBeNull()
  })

  it('reports an error when nothing matches (typo-proof: wrong title is loud, not a silent no-op)', async () => {
    const d = await seed(db.prisma)
    const r = await backfillWritingGrading(db.prisma, d.school.id, '不存在的标题', true)
    expect(r.ok).toBe(false)
  })
})
