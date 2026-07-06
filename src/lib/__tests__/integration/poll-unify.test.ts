import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { unifyPhaseToPoll, unifyPollSiblings, assignPollVote, assignPollVotesBulk, unassignPollVote } from '@/lib/domain/poll-unify'
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
  const sub = (studentId: number, text: string, attempt = 1) =>
    p.submission.create({ data: { assignmentId: textAsg.id, offeringId: textOffering.id, phaseId: textPhase.id, studentId, attempt, status: 'UPLOADED', needsReview: true, recitedText: text } })
  // s1 重交过:旧 attempt 是无关文本,最新一次才逐字命中——报告与匹配都只看每人最新一次
  // (否则份数会大于班级人数,这正是真实数据里出现 85 > 54 的原因)。
  await sub(s1.id, '早期草稿内容', 1)
  const subExact = await sub(s1.id, '英语口语大赛', 2)
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
    const r = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, false)
    if (!r.ok) throw new Error(r.error)
    expect(r.applied).toBe(false)
    expect(r.options).toEqual(['英语口语大赛', '英文歌曲比赛'])
    expect(r.templateClasses).toEqual(['2531323'])
    expect(r.targets).toHaveLength(1)
    // total=3 人(s1 有 2 次 attempt 只算最新一次);pendingReview=4 行(历史 attempt 也要清)。
    expect(r.targets[0]).toMatchObject({ className: '2531324', total: 3, alreadyCanonical: 1, autoMatched: 1, pendingReview: 4, scored: 0 })
    expect(r.targets[0].unmatched).toEqual([
      { submissionId: d.subUnmatched.id, studentNo: '03', studentName: '学生03', text: '想参加朗诵会' },
    ])
    // 作答明细:原文 × 人数 → 命中选项/未匹配(s1 的旧草稿不出现——只看最新一次)。
    expect(r.targets[0].answers).toHaveLength(3)
    expect(r.targets[0].answers).toContainEqual({ text: '英语口语大赛', count: 1, matchedOption: '英语口语大赛' })
    expect(r.targets[0].answers).toContainEqual({ text: '英文歌曲比赛', count: 1, matchedOption: '英文歌曲比赛' })
    expect(r.targets[0].answers).toContainEqual({ text: '想参加朗诵会', count: 1, matchedOption: null })
    // Nothing written: phase still text, submissions untouched, job still pending.
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })).requireText).toBe(true)
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subVariant.id } })).recitedText).toBe('　英文歌曲比赛 ')
    expect(await db.prisma.gradingJob.count({ where: { status: 'PENDING' } })).toBe(1)
  })

  it('apply converts the phase, canonicalizes equivalent answers, keeps unmatched text, clears review + jobs', async () => {
    const d = await seed(db.prisma)
    const r = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    if (!r.ok) throw new Error(r.error)
    expect(r.applied).toBe(true)

    const phase = await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })
    expect(phase).toMatchObject({ requireText: false, requireChoice: true, multiChoice: false, correctChoice: null, itemType: 'objective', choicesJson: OPTIONS })
    const asg = await db.prisma.assignment.findUniqueOrThrow({ where: { id: d.textAsg.id } })
    expect(asg.requireText).toBe(false) // legacy order-1 mirror kept in sync
    expect(asg.version).toBe(1) // in-flight edit forms fenced

    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subExact.id } })).recitedText).toBe('英语口语大赛')
    const variant = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subVariant.id } })
    expect(variant.recitedText).toBe('英文歌曲比赛') // canonicalized
    expect(variant.voteSourceText).toBe('　英文歌曲比赛 ') // 等价改写留痕原始写法 → 可撤销
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subUnmatched.id } })).recitedText).toBe('想参加朗诵会') // preserved verbatim
    // Poll submissions never sit in the review queue, and no AI job may come back to score them.
    expect(await db.prisma.submission.count({ where: { phaseId: d.textPhase.id, needsReview: true } })).toBe(0)
    expect(await db.prisma.gradingJob.count({ where: { status: 'PENDING' } })).toBe(0)

    // Idempotent: the converted phase now reads as a template; nothing left to do.
    const again = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    if (!again.ok) throw new Error(again.error)
    expect(again.targets).toHaveLength(0)
    expect(again.templateClasses.sort()).toEqual(['2531323', '2531324'])
  })

  it('repairs a mid-apply crash on rerun: conversion is the LAST write, so a half-done class is re-detected (审计 R3)', async () => {
    const d = await seed(db.prisma)
    const first = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    if (!first.ok) throw new Error(first.error)

    // 模拟「改写/清理已做、但在改型前崩溃」的中间态:把环节退回默写型(其余产物保留)。
    await db.prisma.phase.update({ where: { id: d.textPhase.id }, data: { requireText: true, requireChoice: false, choicesJson: null, itemType: 'writing' } })
    await db.prisma.assignment.update({ where: { id: d.textAsg.id }, data: { requireText: true } })

    // 重跑:该班必须再次被识别为目标并补齐(而不是被当成模板/已完成而跳过)。
    const rerun = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    if (!rerun.ok) throw new Error(rerun.error)
    expect(rerun.targets.map((t) => t.className)).toContain('2531324')
    const phase = await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })
    expect(phase).toMatchObject({ requireChoice: true, itemType: 'objective', choicesJson: OPTIONS })
    // 已规范化的作答保持原样(此轮按「逐字命中」处理,留痕不被覆盖)。
    const variant = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subVariant.id } })
    expect(variant.recitedText).toBe('英文歌曲比赛')
    expect(variant.voteSourceText).toBe('　英文歌曲比赛 ')
    expect(await db.prisma.submission.count({ where: { phaseId: d.textPhase.id, needsReview: true } })).toBe(0)
  })

  it('a leftover writing job cannot score a converted poll vote (审计 R3 围栏)', async () => {
    const d = await seed(db.prisma)
    const r = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    if (!r.ok) throw new Error(r.error)
    // 直接调用写作评阅入口(模拟撤销窗口外残留/在途的任务落地)——必须自弃(null=就地了结),
    // 且不写任何分数。
    const { autoGradeWritingById } = await import('@/lib/domain/grading-writing')
    expect(await autoGradeWritingById(db.prisma, d.subExact.id)).toBeNull()
    const sub = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subExact.id } })
    expect(sub.aiScore).toBeNull()
    expect(sub.finalScore).toBeNull()
    expect(sub.status).toBe('UPLOADED')
  })

  it('is pinned to the given school: an identically titled assignment in another school is untouched (审计 R6)', async () => {
    const d = await seed(db.prisma)
    // 别校同名作业 + 同序默写环节——绝不能被扫进目标。
    const schoolB = await db.prisma.school.create({ data: { name: 'B', code: 'B' } })
    const tB = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: schoolB.id, staffNo: 'TB', passwordHash: 'x' } })
    const cB = await db.prisma.course.create({ data: { schoolId: schoolB.id, name: 'E', code: 'E' } })
    const clsB = await db.prisma.classGroup.create({ data: { schoolId: schoolB.id, name: 'B1' } })
    const offB = await db.prisma.courseOffering.create({ data: { schoolId: schoolB.id, courseId: cB.id, teacherId: tB.id, classId: clsB.id, year: 'Y', semester: '2' } })
    const asgB = await db.prisma.assignment.create({ data: { offeringId: offB.id, title: TITLE, requireText: true } })
    const phaseB = await db.prisma.phase.create({ data: { assignmentId: asgB.id, order: 1, requireText: true, requireVideo: false, requireEyesClosed: false, itemType: 'writing', graded: true, maxAttempts: 1 } })

    const r = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    if (!r.ok) throw new Error(r.error)
    expect(r.targets.map((t) => t.className)).not.toContain('B1')
    const untouched = await db.prisma.phase.findUniqueOrThrow({ where: { id: phaseB.id } })
    expect(untouched.requireText).toBe(true)
    expect(untouched.requireChoice).toBe(false)
  })

  it('refuses to apply when a target submission carries a score', async () => {
    const d = await seed(db.prisma)
    await db.prisma.submission.update({ where: { id: d.subExact.id }, data: { finalScore: 88 } })
    const r = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    expect(r.ok).toBe(false)
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })).requireText).toBe(true) // untouched
  })
})

describe('unifyPollSiblings (老师自助版,scoped)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('preview reports without writing; apply converts the sibling text phase', async () => {
    const d = await seed(db.prisma)
    const preview = await unifyPollSiblings(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.pollPhase.id, false)
    if (!preview.ok) throw new Error(preview.error)
    expect(preview.targets).toHaveLength(1)
    expect(preview.targets[0]).toMatchObject({ className: '2531324', total: 3, alreadyCanonical: 1, autoMatched: 1 })
    expect((await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })).requireText).toBe(true) // 零写入

    const applied = await unifyPollSiblings(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.pollPhase.id, true)
    if (!applied.ok) throw new Error(applied.error)
    const phase = await db.prisma.phase.findUniqueOrThrow({ where: { id: d.textPhase.id } })
    expect(phase).toMatchObject({ requireChoice: true, itemType: 'objective', choicesJson: OPTIONS })
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subVariant.id } })).recitedText).toBe('英文歌曲比赛')
  })

  it('a text+handwriting hybrid phase is NOT a conversion target (审计 R4) — it lands in skipped', async () => {
    const d = await seed(db.prisma)
    const cls = await db.prisma.classGroup.create({ data: { schoolId: d.school.id, name: '2531399' } })
    const course = await db.prisma.course.findFirstOrThrow()
    const off = await db.prisma.courseOffering.create({ data: { schoolId: d.school.id, courseId: course.id, teacherId: d.teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
    const hybridAsg = await db.prisma.assignment.create({ data: { offeringId: off.id, title: TITLE, requireText: true } })
    const hybrid = await db.prisma.phase.create({ data: { assignmentId: hybridAsg.id, order: 1, requireText: true, requireHandwriting: true, requireVideo: false, requireEyesClosed: false, itemType: 'writing', graded: true, maxAttempts: 1 } })

    const r = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    if (!r.ok) throw new Error(r.error)
    expect(r.targets.map((t) => t.className)).not.toContain('2531399')
    expect(r.skipped.map((s) => s.className)).toContain('2531399')
    const phase = await db.prisma.phase.findUniqueOrThrow({ where: { id: hybrid.id } })
    expect(phase.requireChoice).toBe(false) // 未被改型
    expect(phase.itemType).toBe('writing')
  })

  it('rejects a non-poll source phase as the template', async () => {
    const d = await seed(db.prisma)
    const res = await unifyPollSiblings(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.textPhase.id, false)
    expect(res).toEqual({ ok: false, error: 'err.pollUnifySource' })
  })

  it('blank answers (empty / whitespace-only) count as blank, NOT as 待人工 unmatched (复查 R15)', async () => {
    const d = await seed(db.prisma)
    // 评分页工作台只列非空文本(没内容无从比对归票)——报告把空白算进「待人工」,
    // 老师会去找一条不存在的行。空白单列 blank,unmatched 口径与工作台一致。
    const s4 = await db.prisma.user.create({ data: { role: 'STUDENT', schoolId: d.school.id, studentNo: '04', passwordHash: 'x' } })
    const s5 = await db.prisma.user.create({ data: { role: 'STUDENT', schoolId: d.school.id, studentNo: '05', passwordHash: 'x' } })
    await db.prisma.submission.create({ data: { assignmentId: d.textAsg.id, phaseId: d.textPhase.id, studentId: s4.id, attempt: 1, status: 'UPLOADED', recitedText: '' } })
    await db.prisma.submission.create({ data: { assignmentId: d.textAsg.id, phaseId: d.textPhase.id, studentId: s5.id, attempt: 1, status: 'UPLOADED', recitedText: '　 \t' } })

    const r = await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, false)
    if (!r.ok) throw new Error(r.error)
    expect(r.targets[0]).toMatchObject({ total: 5, blank: 2 })
    expect(r.targets[0].unmatched.map((u) => u.studentNo)).toEqual(['03']) // 空白不冒充待人工
  })

  it("is teacher-scoped: another teacher's same-title class is not a target, and a foreign source is unreachable", async () => {
    const d = await seed(db.prisma)
    const other = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: d.school.id, staffNo: 'T9', passwordHash: 'x' } })
    // 另一位老师访问不到我的模板环节。
    expect(await unifyPollSiblings(db.prisma, d.school.id, other.id, 'TEACHER', d.pollPhase.id, false)).toEqual({ ok: false, error: 'err.subNoAccess' })
    // 我的统一也扫不到另一位老师名下的同名班。
    const cls = await db.prisma.classGroup.create({ data: { schoolId: d.school.id, name: '2531399' } })
    const course = await db.prisma.course.findFirstOrThrow()
    const off = await db.prisma.courseOffering.create({ data: { schoolId: d.school.id, courseId: course.id, teacherId: other.id, classId: cls.id, year: 'Y', semester: '2' } })
    const foreignAsg = await db.prisma.assignment.create({ data: { offeringId: off.id, title: TITLE, requireText: true } })
    await db.prisma.phase.create({ data: { assignmentId: foreignAsg.id, order: 1, requireText: true, requireVideo: false, requireEyesClosed: false, itemType: 'writing', graded: true, maxAttempts: 1 } })
    const res = await unifyPollSiblings(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.pollPhase.id, false)
    if (!res.ok) throw new Error(res.error)
    expect(res.targets.map((g) => g.className)).toEqual(['2531324']) // 不含 2531399
  })
})

describe('assignPollVote (人工归票)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('writes the canonical option for a valid pick; rejects an off-list option', async () => {
    const d = await seed(db.prisma)
    await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)

    const bad = await assignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id, '不存在的选项')
    expect(bad).toEqual({ ok: false, error: 'err.badChoice' })

    const good = await assignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id, '英语口语大赛')
    expect(good).toEqual({ ok: true, assignmentId: d.textAsg.id })
    let sub = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subUnmatched.id } })
    expect(sub.recitedText).toBe('英语口语大赛')
    expect(sub.voteSourceText).toBe('想参加朗诵会') // 归票留痕原文

    // 改票不覆盖首次留痕(撤销恢复的永远是学生的原始作答)。
    await assignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id, '英文歌曲比赛')
    sub = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subUnmatched.id } })
    expect(sub.recitedText).toBe('英文歌曲比赛')
    expect(sub.voteSourceText).toBe('想参加朗诵会')

    // 撤销:恢复原文、清留痕;再撤一次报「无留痕」。
    expect(await unassignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id)).toEqual({ ok: true, assignmentId: d.textAsg.id })
    sub = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subUnmatched.id } })
    expect(sub.recitedText).toBe('想参加朗诵会')
    expect(sub.voteSourceText).toBeNull()
    expect(await unassignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id)).toEqual({ ok: false, error: 'err.noVoteSource' })
  })

  it('rejects assign/bulk/undo on a keyed single-choice quiz (审计 R8)', async () => {
    const d = await seed(db.prisma)
    await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    // 先正常归一票制造留痕,再把环节配上答案键变成 quiz。
    await assignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id, '英语口语大赛')
    await db.prisma.phase.update({ where: { id: d.textPhase.id }, data: { correctChoice: '英语口语大赛' } })

    expect(await assignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subVariant.id, '英语口语大赛')).toEqual({ ok: false, error: 'err.pollOnlyAssign' })
    expect(await assignPollVotesBulk(db.prisma, d.school.id, d.teacher.id, 'TEACHER', [d.subVariant.id], '英语口语大赛')).toEqual({ ok: false, error: 'err.pollOnlyAssign' })
    expect(await unassignPollVote(db.prisma, d.school.id, d.teacher.id, 'TEACHER', d.subUnmatched.id)).toEqual({ ok: false, error: 'err.pollOnlyAssign' })
    // 均零写入:留痕与作答保持原状。
    const sub = await db.prisma.submission.findUniqueOrThrow({ where: { id: d.subUnmatched.id } })
    expect(sub.recitedText).toBe('英语口语大赛')
    expect(sub.voteSourceText).toBe('想参加朗诵会')
  })

  it('is scoped: another teacher cannot assign votes on my submission', async () => {
    const d = await seed(db.prisma)
    await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    const other = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: d.school.id, staffNo: 'T2', passwordHash: 'x' } })
    const res = await assignPollVote(db.prisma, d.school.id, other.id, 'TEACHER', d.subUnmatched.id, '英语口语大赛')
    expect(res).toEqual({ ok: false, error: 'err.subNoAccess' })
  })

  it('bulk-assigns a group in one call, each keeping its own source trace; foreign id rejects wholesale', async () => {
    const d = await seed(db.prisma)
    await unifyPhaseToPoll(db.prisma, d.school.id, TITLE, 1, true)
    // 再造一份与 subUnmatched 相同作答的提交(另一个学生)。
    const s4 = await db.prisma.user.create({ data: { role: 'STUDENT', schoolId: d.school.id, studentNo: '04', name: '学生04', passwordHash: 'x' } })
    const twin = await db.prisma.submission.create({ data: { assignmentId: d.textAsg.id, offeringId: d.textAsg.offeringId, phaseId: d.textPhase.id, studentId: s4.id, status: 'UPLOADED', needsReview: false, recitedText: '想参加朗诵会' } })

    const res = await assignPollVotesBulk(db.prisma, d.school.id, d.teacher.id, 'TEACHER', [d.subUnmatched.id, twin.id], '英语口语大赛')
    expect(res).toEqual({ ok: true, assignmentId: d.textAsg.id })
    for (const id of [d.subUnmatched.id, twin.id]) {
      const row = await db.prisma.submission.findUniqueOrThrow({ where: { id } })
      expect(row.recitedText).toBe('英语口语大赛')
      expect(row.voteSourceText).toBe('想参加朗诵会') // 各自留痕
    }

    // 混入越权 id → 整体拒绝零写入。
    const other = await db.prisma.user.create({ data: { role: 'TEACHER', schoolId: d.school.id, staffNo: 'T8', passwordHash: 'x' } })
    const bad = await assignPollVotesBulk(db.prisma, d.school.id, other.id, 'TEACHER', [d.subUnmatched.id, twin.id], '英文歌曲比赛')
    expect(bad).toEqual({ ok: false, error: 'err.subNoAccess' })
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: twin.id } })).recitedText).toBe('英语口语大赛') // 未被改动
  })
})
