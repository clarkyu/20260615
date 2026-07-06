import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { unifyPhaseToPoll, assignPollVote } from '@/lib/domain/poll-unify'
import type { PrismaClient } from '@prisma/client'

// 环节统一为单选投票:模板班(投票)的选项套到误配成默写文本的班上;学生作答零删除——
// 归一化等价的规范化归票、对不上的原样保留转人工;needsReview 清理、挂起评阅任务撤销;
// dry-run 零写入;有分数时拒绝执行;幂等。

const TITLE = '期末考核：2025-2026-2'
const OPTIONS = JSON.stringify(['英语口语大赛', '英文歌曲比赛'])

async function seed(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const mk = async (clsName: string) => {
    const cls = await p.classGroup.create({ data: { schoolId: school.id, name: clsName } })
    return p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  }
  // 模板班(已是单选投票)+ 目标班(误配成默写文本)。
  const pollOffering = await mk('2531323')
  const textOffering = await mk('2531324')
  const pollAsg = await p.assignment.create({ data: { offeringId: pollOffering.id, title: TITLE, requireText: false } })
  // Phase 的 requireText/requireVideo/requireEyesClosed 列默认 true(legacy)——表单发布
  // 时全部显式写入,这里同样显式置好,还原真实的「纯投票」与「纯默写」形态。
  const pollPhase = await p.phase.create({ data: { assignmentId: pollAsg.id, order: 1, requireChoice: true, multiChoice: false, choicesJson: OPTIONS, itemType: 'objective', requireText: false, requireVideo: false, requireEyesClosed: false, graded: true, maxAttempts: 1 } })
  const textAsg = await p.assignment.create({ data: { offeringId: textOffering.id, title: TITLE, requireText: true } })
  const textPhase = await p.phase.create({ data: { assignmentId: textAsg.id, order: 1, requireText: true, requireVideo: false, requireEyesClosed: false, itemType: 'writing', graded: true, maxAttempts: 1 } })
  const student = async (no: string) => p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: no, name: `学生${no}`, passwordHash: 'x' } })
  const s1 = await student('01') // 原文与选项逐字相同
  const s2 = await student('02') // 全角/空白变体 → 归一化等价
  const s3 = await student('03') // 对不上任何选项
  const sub = (studentId: number, text: string) =>
    p.submission.create({ data: { assignmentId: textAsg.id, offeringId: textOffering.id, phaseId: textPhase.id, studentId, status: 'UPLOADED', needsReview: true, recitedText: text } })
  const subExact = await sub(s1.id, '英语口语大赛')
  const subVariant = await sub(s2.id, '　英文歌曲比赛 ')
  const subUnmatched = await sub(s3.id, '想参加朗诵会')
  await p.gradingJob.create({ data: { submissionId: subVariant.id, kind: 'writing', status: 'PENDING' } })
  return { school, teacher, pollAsg, pollPhase, textAsg, textPhase, subExact, subVariant, subUnmatched }
}

describe('unifyPhaseToPoll', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('dry-run reports the exact plan and writes nothing', async () => {
    const d = await seed(db.prisma)
    const r = await unifyPhaseToPoll(db.prisma, TITLE, 1, false)
    if (!r.ok) throw new Error(r.error)
    expect(r.applied).toBe(false)
    expect(r.options).toEqual(['英语口语大赛', '英文歌曲比赛'])
    expect(r.templateClasses).toEqual(['2531323'])
    expect(r.targets).toHaveLength(1)
    expect(r.targets[0]).toMatchObject({ className: '2531324', total: 3, alreadyCanonical: 1, autoMatched: 1, pendingReview: 3, scored: 0 })
    expect(r.targets[0].unmatched).toEqual([
      { submissionId: d.subUnmatched.id, studentNo: '03', studentName: '学生03', text: '想参加朗诵会' },
    ])
    // Nothing written: phase still text, submissions untouched, job still pending.
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })).requireText).toBe(true)
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subVariant.id } })).recitedText).toBe('　英文歌曲比赛 ')
    expect(await db.prisma.gradingJob.count({ where: { status: 'PENDING' } })).toBe(1)
  })

  it('apply converts the phase, canonicalizes equivalent answers, keeps unmatched text, clears review + jobs', async () => {
    const d = await seed(db.prisma)
    const r = await unifyPhaseToPoll(db.prisma, TITLE, 1, true)
    if (!r.ok) throw new Error(r.error)
    expect(r.applied).toBe(true)

    const phase = await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })
    expect(phase).toMatchObject({ requireText: false, requireChoice: true, multiChoice: false, correctChoice: null, itemType: 'objective', choicesJson: OPTIONS })
    const asg = await db.prisma.assignment.findUniqueOrThrow({ where: { id: d.textAsg.id } })
    expect(asg.requireText).toBe(false) // legacy order-1 mirror kept in sync
    expect(asg.version).toBe(1) // in-flight edit forms fenced

    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subExact.id } })).recitedText).toBe('英语口语大赛')
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subVariant.id } })).recitedText).toBe('英文歌曲比赛') // canonicalized
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subUnmatched.id } })).recitedText).toBe('想参加朗诵会') // preserved verbatim
    // Poll submissions never sit in the review queue, and no AI job may come back to score them.
    expect(await db.prisma.submission.count({ where: { phaseId: d.textPhase.id, needsReview: true } })).toBe(0)
    expect(await db.prisma.gradingJob.count({ where: { status: 'PENDING' } })).toBe(0)

    // Idempotent: the converted phase now reads as a template; nothing left to do.
    const again = await unifyPhaseToPoll(db.prisma, TITLE, 1, true)
    if (!again.ok) throw new Error(again.error)
    expect(again.targets).toHaveLength(0)
    expect(again.templateClasses.sort()).toEqual(['2531323', '2531324'])
  })

  it('refuses to apply when a target submission carries a score', async () => {
    const d = await seed(db.prisma)
    await db.prisma.submission.update({ where: { id: d.subExact.id }, data: { finalScore: 88 } })
    const r = await unifyPhaseToPoll(db.prisma, TITLE, 1, true)
    expect(r.ok).toBe(false)
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })).requireText).toBe(true) // untouched
  })
})

describe('assignPollVote (人工归票)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('writes the canonical option for a valid pick; rejects an off-list option', async () => {
    const d = await seed(db.prisma)
    await unifyPhaseToPoll(db.prisma, TITLE, 1, true)

    const bad = await assignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id, '不存在的选项')
    expect(bad).toEqual({ ok: false, error: 'err.badChoice' })

    const good = await assignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id, '英语口语大赛')
    expect(good).toEqual({ ok: true, assignmentId: d.textAsg.id })
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subUnmatched.id } })).recitedText).toBe('英语口语大赛')
  })

  it('is scoped: another teacher cannot assign votes on my submission', async () => {
    const d = await seed(db.prisma)
    await unifyPhaseToPoll(db.prisma, TITLE, 1, true)
    const other = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: d.school.id, staffNo: 'T2', passwordHash: 'x' } })
    const res = await assignPollVote(db.prisma, d.school.id, other.id, 'TEACHER', d.subUnmatched.id, '英语口语大赛')
    expect(res).toEqual({ ok: false, error: 'err.subNoAccess' })
  })
})
