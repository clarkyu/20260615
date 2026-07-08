import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { freshDb, type TestDb } from './harness'
import { backfillWritingGrading, requeueMediaGrading, requeueShadowGrading, resolveMissingMedia } from '@/lib/domain/grading-backfill'
import { claimForProcessing } from '@/lib/repo/submissions'
import type { PrismaClient } from '@prisma/client'
import type { ObjectHealth } from '@/lib/storage'

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

// ── 修复 ③:媒体重评 + claim 陷阱 ────────────────────────────────────────────

async function seedSpeech(p: PrismaClient) {
  const school = await p.school.create({ data: { name: 'S', code: 'S' } })
  const teacher = await p.user.create({ data: { role: 'TEACHER', schoolId: school.id, staffNo: 'T1', passwordHash: 'x' } })
  const course = await p.course.create({ data: { schoolId: school.id, name: 'E', code: 'E' } })
  const cls = await p.classGroup.create({ data: { schoolId: school.id, name: 'C1' } })
  const offering = await p.courseOffering.create({ data: { schoolId: school.id, courseId: course.id, teacherId: teacher.id, classId: cls.id, year: 'Y', semester: '2' } })
  const asg = await p.assignment.create({ data: { offeringId: offering.id, title: TITLE } })
  const phase = await p.phase.create({ data: { assignmentId: asg.id, order: 3, requireVideo: true, requireText: false, requireEyesClosed: false, itemType: 'speech', graded: true, maxAttempts: 3 } })
  const student = async (no: string) => p.user.create({ data: { role: 'STUDENT', schoolId: school.id, studentNo: no, passwordHash: 'x' } })
  const sub = (studentId: number, over: object) =>
    p.submission.create({ data: { assignmentId: asg.id, offeringId: offering.id, phaseId: phase.id, studentId, attempt: 1, ...over } })
  return { school, asg, phase, student, sub }
}

describe('requeueMediaGrading (修复 ③)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('dry-run 报目标数;apply 重置/新建 kind=submission 的任务,GRADED/有分/无媒体的不碰', async () => {
    const d = await seedSpeech(db.prisma)
    const s = await Promise.all(['01', '02', '03', '04', '05', '06'].map(d.student))
    const failed = await d.sub(s[0].id, { status: 'FAILED', videoKey: 'k/1', needsReview: true })
    const stuck = await d.sub(s[1].id, { status: 'PROCESSING', videoKey: 'k/2', needsReview: true })
    const uploaded = await d.sub(s[2].id, { status: 'UPLOADED', videoKey: 'k/3', needsReview: true })
    await d.sub(s[3].id, { status: 'GRADED', videoKey: 'k/4', finalScore: 90 }) // 已定稿不碰
    await d.sub(s[4].id, { status: 'FLAGGED', videoKey: 'k/5', aiScore: 70 }) // 有 AI 分不碰
    await d.sub(s[5].id, { status: 'UPLOADED', recitedText: '无媒体' }) // 无媒体指针不碰
    // failed 行已有一个耗尽的死信任务——重评必须把它重置(attempts 归零),不是新建。
    await db.prisma.gradingJob.create({ data: { submissionId: failed.id, kind: 'submission', status: 'FAILED', attempts: 4, lastError: '无法获取视频（404）' } })

    const dry = await requeueMediaGrading(db.prisma, d.school.id, TITLE, false)
    if (!dry.ok) throw new Error(dry.error)
    expect(dry).toMatchObject({ applied: false, targets: 3, jobsCreated: 0, jobsReset: 0 })
    expect(dry.perPhaseOrder).toEqual([{ phaseOrder: 3, count: 3 }])
    expect(await db.prisma.gradingJob.count()).toBe(1) // 零写入

    const r = await requeueMediaGrading(db.prisma, d.school.id, TITLE, true)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, targets: 3, jobsCreated: 2, jobsReset: 1 })
    const jobs = await db.prisma.gradingJob.findMany({ orderBy: { submissionId: 'asc' } })
    expect(jobs.map((j) => j.submissionId).sort((a, b) => a - b)).toEqual([failed.id, stuck.id, uploaded.id].sort((a, b) => a - b))
    for (const j of jobs) expect(j).toMatchObject({ kind: 'submission', status: 'PENDING', attempts: 0 })
  })
})

// ── 逐句跟读重评(清扫盲区补漏):163 份真背诵漏在死信里 ──────────────────────────
describe('requeueShadowGrading (清扫盲区补漏)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('只捞有 ShadowTake 的失败/卡死/未评提交,重置成 kind=shadow;空提交/已评/有分不碰', async () => {
    const d = await seedSpeech(db.prisma)
    const s = await Promise.all(['01', '02', '03', '04', '05'].map(d.student))
    // 逐句音频存在 ShadowTake 里(不在 videoKey/audioKey)——这正是 media 重评看不到的盲区。
    const withTake = async (studentId: number, over: object) => {
      const sub = await d.sub(studentId, over)
      await db.prisma.shadowTake.create({ data: { submissionId: sub.id, order: 1, audioKey: `t/${sub.id}` } })
      return sub
    }
    const failed = await withTake(s[0].id, { status: 'FAILED', needsReview: true })
    const stuck = await withTake(s[1].id, { status: 'PROCESSING' })
    const uploaded = await withTake(s[2].id, { status: 'UPLOADED' })
    await withTake(s[3].id, { status: 'GRADED', finalScore: 90 }) // 已定稿不碰
    await d.sub(s[4].id, { status: 'UPLOADED' }) // 无 ShadowTake(空提交)不碰
    // failed 行已有耗尽死信——重评必须重置(attempts 归零),不是新建。
    await db.prisma.gradingJob.create({ data: { submissionId: failed.id, kind: 'shadow', status: 'FAILED', attempts: 4, lastError: 'x' } })

    const dry = await requeueShadowGrading(db.prisma, d.school.id, TITLE, false)
    if (!dry.ok) throw new Error(dry.error)
    expect(dry).toMatchObject({ applied: false, targets: 3, jobsCreated: 0, jobsReset: 0 })
    expect(dry.perPhaseOrder).toEqual([{ phaseOrder: 3, count: 3 }])
    expect(await db.prisma.gradingJob.count()).toBe(1) // 零写入

    const r = await requeueShadowGrading(db.prisma, d.school.id, TITLE, true)
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, targets: 3, jobsCreated: 2, jobsReset: 1 })
    const jobs = await db.prisma.gradingJob.findMany({ orderBy: { submissionId: 'asc' } })
    expect(jobs.map((j) => j.submissionId).sort((a, b) => a - b)).toEqual([failed.id, stuck.id, uploaded.id].sort((a, b) => a - b))
    for (const j of jobs) expect(j).toMatchObject({ kind: 'shadow', status: 'PENDING', attempts: 0 })
  })

  it('无匹配时报错(标题打错要响,不是静默空跑)', async () => {
    const d = await seedSpeech(db.prisma)
    const r = await requeueShadowGrading(db.prisma, d.school.id, '不存在的标题', true)
    expect(r.ok).toBe(false)
  })
})

describe('claimForProcessing — 卡死回收(claim 陷阱修复)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  it('新鲜的 PROCESSING(活跃运行)不可抢;过期的可接管;GRADED 永远不可', async () => {
    const d = await seedSpeech(db.prisma)
    const st = await d.student('01')
    const fresh = await d.sub(st.id, { status: 'PROCESSING', videoKey: 'k/f' })
    expect((await claimForProcessing(db.prisma, fresh.id)).count).toBe(0) // 活跃运行,不抢

    // 把 updatedAt 倒回 16 分钟前(@updatedAt 无法经 prisma 写,用原生 SQL 模拟死运行)。
    await db.prisma.$executeRawUnsafe(
      `UPDATE Submission SET updatedAt = datetime('now', '-16 minutes') WHERE id = ${fresh.id}`,
    )
    expect((await claimForProcessing(db.prisma, fresh.id)).count).toBe(1) // 死运行遗留,接管

    const st2 = await d.student('02')
    const graded = await d.sub(st2.id, { status: 'GRADED', videoKey: 'k/g', finalScore: 88 })
    expect((await claimForProcessing(db.prisma, graded.id)).count).toBe(0) // 定稿不可重开
  })

  it('FAILED 可被认领重评——否则 requeue 的任务永远空转(232 份卡死死循环的根因)', async () => {
    const d = await seedSpeech(db.prisma)
    const st = await d.student('03')
    // requeue 只重置 GradingJob→PENDING,提交仍 FAILED;后台评阅必须能认领它,否则
    // autoGradeSubmission 认领 count=0 → 返回「成功但没评」→ 任务退回 PENDING 无限空转。
    const failed = await d.sub(st.id, { status: 'FAILED', videoKey: 'k/x', needsReview: true })
    expect((await claimForProcessing(db.prisma, failed.id)).count).toBe(1) // FAILED 接受重评
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe('PROCESSING')
  })
})

// ── 上传坏死自动归档缺交(降老师负担):无内容可评的死信不该扔给老师 ──────────────────
describe('resolveMissingMedia (上传坏死自动归档)', () => {
  let db: TestDb
  beforeEach(() => { db = freshDb() })
  afterEach(async () => { await db?.cleanup() })

  const probe = (table: Record<string, ObjectHealth>) => async (key: string) => table[key] ?? 'missing'
  const stuckJob = (p: PrismaClient, submissionId: number, kind: 'submission' | 'shadow' | 'writing', status: 'FAILED' | 'PENDING' | 'PROCESSING' = 'FAILED', attempts = 4, lastError?: string) =>
    p.gradingJob.create({ data: { submissionId, kind, status, attempts, lastError } })

  it('dry-run 报告不写:只归档确证「全空/全缺」的;死信+卡住(PENDING/PROCESSING)都扫,刚提交(attempts=0)/健康/判不准/写作不碰', async () => {
    const d = await seedSpeech(db.prisma)
    const s = await Promise.all(['01', '02', '03', '04', '05', '06', '07', '08'].map(d.student))
    const mediaGone = await d.sub(s[0].id, { status: 'FAILED', videoKey: 'v/gone' }); await stuckJob(db.prisma, mediaGone.id, 'submission', 'FAILED')
    const mediaEmpty = await d.sub(s[1].id, { status: 'FAILED', videoKey: 'v/empty' }); await stuckJob(db.prisma, mediaEmpty.id, 'submission', 'FAILED')
    // 重跑后卡在 PENDING(attempts≥1)的坏行:老版只扫 FAILED 会漏,新版必须捞到。
    const pendingBroken = await d.sub(s[2].id, { status: 'UPLOADED', videoKey: 'v/pb' }); await stuckJob(db.prisma, pendingBroken.id, 'submission', 'PENDING', 2)
    const mediaOk = await d.sub(s[3].id, { status: 'FAILED', videoKey: 'v/ok' }); await stuckJob(db.prisma, mediaOk.id, 'submission', 'FAILED')
    const mediaBlip = await d.sub(s[4].id, { status: 'FAILED', videoKey: 'v/blip' }); await stuckJob(db.prisma, mediaBlip.id, 'submission', 'FAILED')
    const writingDead = await d.sub(s[5].id, { status: 'FAILED', recitedText: '有文本' }); await stuckJob(db.prisma, writingDead.id, 'writing', 'FAILED')
    // 刚提交、还没试评(attempts=0):即便媒体此刻探不到也别碰(可能还在最终一致中)。
    const freshPending = await d.sub(s[6].id, { status: 'UPLOADED', videoKey: 'v/fresh' }); await stuckJob(db.prisma, freshPending.id, 'submission', 'PENDING', 0)
    const shadowBad = await d.sub(s[7].id, { status: 'UPLOADED' }); await stuckJob(db.prisma, shadowBad.id, 'shadow', 'FAILED')
    await db.prisma.shadowTake.create({ data: { submissionId: shadowBad.id, order: 1, audioKey: 'sk/b1' } })
    await db.prisma.shadowTake.create({ data: { submissionId: shadowBad.id, order: 2, audioKey: 'sk/b2' } })

    const table: Record<string, ObjectHealth> = { 'v/gone': 'missing', 'v/empty': 'empty', 'v/pb': 'missing', 'v/ok': 'ok', 'v/blip': 'unknown', 'v/fresh': 'missing', 'sk/b1': 'empty', 'sk/b2': 'missing' }
    const r = await resolveMissingMedia(db.prisma, d.school.id, TITLE, false, probe(table))
    if (!r.ok) throw new Error(r.error)
    // freshPending(attempts=0)守卫排除;写作有文本不碰;健康/unknown 不碰;pendingBroken 被捞到。
    expect(r).toMatchObject({ applied: false, scanned: 7, missing: 4, skippedHealthy: 1, skippedUnknown: 1, skippedWriting: 1 })
    expect(r.sampleIds).toContain(pendingBroken.id) // PENDING 卡住的坏行确实被捞到
    expect(r.sampleIds).not.toContain(freshPending.id) // 刚提交的没碰
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: mediaGone.id } })).status).toBe('FAILED') // 零写入
    expect(await db.prisma.gradingJob.count()).toBe(8)
  })

  it('apply 归档为 MISSING + 删死信任务;健康的保留;幂等重跑 missing=0', async () => {
    const d = await seedSpeech(db.prisma)
    const s = await Promise.all(['01', '02', '03'].map(d.student))
    const gone = await d.sub(s[0].id, { status: 'FAILED', videoKey: 'v/gone', needsReview: true }); await stuckJob(db.prisma, gone.id, 'submission')
    const ok = await d.sub(s[1].id, { status: 'FAILED', videoKey: 'v/ok' }); await stuckJob(db.prisma, ok.id, 'submission')
    const shadowBad = await d.sub(s[2].id, { status: 'UPLOADED' }); await stuckJob(db.prisma, shadowBad.id, 'shadow')
    await db.prisma.shadowTake.create({ data: { submissionId: shadowBad.id, order: 1, audioKey: 'sk/b1' } })

    const table: Record<string, ObjectHealth> = { 'v/gone': 'missing', 'v/ok': 'ok', 'sk/b1': 'empty' }
    const r = await resolveMissingMedia(db.prisma, d.school.id, TITLE, true, probe(table))
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, missing: 2 })
    for (const id of [gone.id, shadowBad.id]) {
      const sub = await db.prisma.submission.findUniqueOrThrow({ where: { id } })
      expect(sub.status).toBe('MISSING')
      expect(sub.needsReview).toBe(false)
      expect(sub.feedback).toContain('缺交')
      expect(await db.prisma.gradingJob.findUnique({ where: { submissionId: id } })).toBeNull() // 死信删掉
    }
    // 健康 media 保留:仍 FAILED,任务还在(留给重评)。
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: ok.id } })).status).toBe('FAILED')
    expect(await db.prisma.gradingJob.findUnique({ where: { submissionId: ok.id } })).not.toBeNull()
    // 幂等:已 MISSING 的排除,再跑只剩健康的 ok,归档 0。
    const r2 = await resolveMissingMedia(db.prisma, d.school.id, TITLE, true, probe(table))
    if (!r2.ok) throw new Error(r2.error)
    expect(r2.missing).toBe(0)
  })

  it('内容损坏(媒体健康、但评阅报 corrupt)也归档缺交,记进 corruptContent;健康且报错非损坏的留着重评', async () => {
    const d = await seedSpeech(db.prisma)
    const s = await Promise.all(['01', '02', '03'].map(d.student))
    const empty = await d.sub(s[0].id, { status: 'FAILED', videoKey: 'v/empty' }); await stuckJob(db.prisma, empty.id, 'submission', 'FAILED', 4, 'grading did not complete')
    const corrupt = await d.sub(s[1].id, { status: 'FAILED', videoKey: 'v/corrupt' }); await stuckJob(db.prisma, corrupt.id, 'submission', 'FAILED', 4, 'Gemini 400: The video is corrupt or in an unsupported format')
    const healthy = await d.sub(s[2].id, { status: 'FAILED', videoKey: 'v/ok2' }); await stuckJob(db.prisma, healthy.id, 'submission', 'FAILED', 4, 'grading did not complete')

    // v/corrupt 探针 'ok'(对象在、有字节),但评阅明确报损坏 → 无内容可评,归档。
    const table: Record<string, ObjectHealth> = { 'v/empty': 'empty', 'v/corrupt': 'ok', 'v/ok2': 'ok' }
    const r = await resolveMissingMedia(db.prisma, d.school.id, TITLE, true, probe(table))
    if (!r.ok) throw new Error(r.error)
    expect(r).toMatchObject({ applied: true, missing: 2, emptyContent: 1, corruptContent: 1, skippedHealthy: 1 })
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe('MISSING')
    const c = await db.prisma.submission.findUniqueOrThrow({ where: { id: corrupt.id } })
    expect(c.status).toBe('MISSING')
    expect(c.feedback).toContain('损坏') // 损坏用专属留痕,区别于「未成功上传」
    // 健康媒体 + 报错非损坏(可能是瞬时/其它)→ 不归档,留着重评。
    expect((await db.prisma.submission.findUniqueOrThrow({ where: { id: healthy.id } })).status).toBe('FAILED')
  })

  it('无死信目标时报错(标题打错要响,不静默空跑)', async () => {
    const d = await seedSpeech(db.prisma)
    const r = await resolveMissingMedia(db.prisma, d.school.id, '不存在的标题', true, probe({}))
    expect(r.ok).toBe(false)
  })
})
