import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import { assignments, attempts, classMembers, classes, items, responses, users } from '@/lib/db/schema'
import { gradingQueue, pendingReviewCount, queueFacets, teacherGrade, teacherGradeSchema } from '@/lib/db/grading-queue'
import { createClassWithCode } from '@/lib/db/assignments'

// 批改队列(SPEC §8 / §5.3):范围 = 本教师班级任务 + 自由练习;教师终评覆盖 AI、夹分、needsReview 清零、
// 总分重算;别的老师的班级看不到、改不了。需要已迁移 + 已种子的 DATABASE_URL。

describe('teacherGradeSchema', () => {
  it('给分或确认二选一', () => {
    expect(teacherGradeSchema.safeParse({ score: 3 }).success).toBe(true)
    expect(teacherGradeSchema.safeParse({ confirm: true }).success).toBe(true)
    expect(teacherGradeSchema.safeParse({ feedback: 'x' }).success).toBe(false)
    expect(teacherGradeSchema.safeParse({ score: -1 }).success).toBe(false)
  })
})

const url = process.env.DATABASE_URL
const PAPER = 'hubei-zsb-english-2025'

describe.skipIf(!url)('批改队列(真库)', () => {
  let db: Db
  let teacherA: string
  let teacherB: string
  let student: string
  const userIds: string[] = []
  const classIds: string[] = []
  const attemptIds: string[] = []
  const RUN = `${Date.now()}`
  let shortAnswerItem: { id: string; score: number; number: number }
  let fillItem: { id: string; score: number; number: number }

  beforeAll(async () => {
    db = getDb()
    const mk = async (role: 'teacher' | 'student', tag: string) => {
      const [u] = await db.insert(users).values({ casdoorSub: `test-gq-${tag}-${RUN}`, name: `GQ${tag}`, role }).returning({ id: users.id })
      userIds.push(u!.id)
      return u!.id
    }
    teacherA = await mk('teacher', 'A')
    teacherB = await mk('teacher', 'B')
    student = await mk('student', 'S')
    const rows = await db.select({ id: items.id, score: items.score, number: items.number, type: items.type }).from(items).where(eq(items.paperId, PAPER))
    shortAnswerItem = rows.find((r) => r.type === 'short_answer')!
    fillItem = rows.find((r) => r.type === 'fill')!
  })

  afterAll(async () => {
    if (attemptIds.length) {
      await db.delete(responses).where(inArray(responses.attemptId, attemptIds))
      await db.delete(attempts).where(inArray(attempts.id, attemptIds))
    }
    if (classIds.length) {
      await db.delete(assignments).where(inArray(assignments.classId, classIds))
      await db.delete(classes).where(inArray(classes.id, classIds))
    }
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  })

  async function attemptFor(teacherId: string | null, patch: Partial<typeof responses.$inferInsert> = {}) {
    let assignmentId: string | null = null
    if (teacherId) {
      const c = await createClassWithCode(db, { name: `GQ-${RUN}`, teacherId })
      classIds.push(c.id)
      await db.insert(classMembers).values({ classId: c.id, userId: student })
      const [a] = await db.insert(assignments).values({ classId: c.id, paperId: PAPER, mode: 'exam', title: `GQ 任务 ${RUN}`, createdBy: teacherId }).returning({ id: assignments.id })
      assignmentId = a!.id
    }
    const [t] = await db.insert(attempts).values({ userId: student, paperId: PAPER, assignmentId, mode: 'exam', status: 'submitted', submittedAt: new Date() }).returning({ id: attempts.id })
    attemptIds.push(t!.id)
    const [r] = await db
      .insert(responses)
      .values({
        attemptId: t!.id,
        itemId: shortAnswerItem.id,
        answer: { type: 'text', value: `Because he wanted to help ${RUN}` },
        clientUpdatedAt: new Date(),
        score: 1,
        gradeSource: 'ai',
        needsReview: true,
        feedback: 'AI 评语',
        gradeDetail: { verdict: 'graded', ai: { score: 1, confidence: 0.4, keyPointsHit: ['help'], issues: ['太短'] } },
        ...patch,
      })
      .returning({ id: responses.id })
    return { attemptId: t!.id, responseId: r!.id, assignmentId }
  }

  it('范围:本教师班级任务 + 自由练习可见;别的老师的看不见', async () => {
    const mine = await attemptFor(teacherA)
    const free = await attemptFor(null)
    const other = await attemptFor(teacherB)
    const qa = await gradingQueue(db, teacherA, { scope: 'needs_review', limit: 500 })
    const ids = new Set(qa.map((r) => r.responseId))
    expect(ids.has(mine.responseId)).toBe(true)
    expect(ids.has(free.responseId)).toBe(true)
    expect(ids.has(other.responseId)).toBe(false)
    const row = qa.find((r) => r.responseId === mine.responseId)!
    expect(row.answerText).toContain('help')
    expect(row.ai?.confidence).toBe(0.4)
    expect(row.assignmentTitle).toBe(`GQ 任务 ${RUN}`)
    expect(row.item.number).toBe(shortAnswerItem.number)

    const facets = await queueFacets(db, teacherA)
    expect(facets.assignments.some((a) => a.id === mine.assignmentId && a.pending === 1)).toBe(true)
    expect(facets.assignments.some((a) => a.id === other.assignmentId)).toBe(false)
    expect(facets.items.some((i) => i.id === shortAnswerItem.id)).toBe(true)
    expect(await pendingReviewCount(db, teacherA)).toBeGreaterThanOrEqual(2)

    // 按任务筛选 + 按 attempt 筛选
    expect((await gradingQueue(db, teacherA, { assignmentId: mine.assignmentId! })).map((r) => r.responseId)).toEqual([mine.responseId])
    expect((await gradingQueue(db, teacherA, { attemptId: free.attemptId })).map((r) => r.responseId)).toEqual([free.responseId])
  })

  it('作答中的 attempt 不进队列;抽查范围列出非待复核的主观题', async () => {
    const x = await attemptFor(teacherA, { needsReview: false })
    await db.update(attempts).set({ status: 'in_progress' }).where(eq(attempts.id, x.attemptId))
    expect((await gradingQueue(db, teacherA, { attemptId: x.attemptId, scope: 'subjective' })).length).toBe(0)
    await db.update(attempts).set({ status: 'graded' }).where(eq(attempts.id, x.attemptId))
    expect((await gradingQueue(db, teacherA, { attemptId: x.attemptId, scope: 'needs_review' })).length).toBe(0)
    expect((await gradingQueue(db, teacherA, { attemptId: x.attemptId, scope: 'subjective' })).length).toBe(1)
  })

  it('教师改分:夹到 0..满分 + 0.5 步进,终评标记,needsReview 清零,总分重算;确认沿用 AI 分', async () => {
    const a = await attemptFor(teacherA)
    const out = await teacherGrade(db, teacherA, a.responseId, { score: 99.3, feedback: '要点齐了' })
    expect(out).toEqual({ ok: true, score: shortAnswerItem.score, attemptId: a.attemptId })
    const r = await db.query.responses.findFirst({ where: eq(responses.id, a.responseId) })
    expect(r?.gradeSource).toBe('teacher')
    expect(r?.needsReview).toBe(false)
    expect(r?.feedback).toBe('要点齐了')
    const d = r?.gradeDetail as { ai?: { score: number }; teacher?: { score: number; by: string; confirmed: boolean } }
    expect(d.ai?.score).toBe(1) // AI 分保留供比对
    expect(d.teacher).toMatchObject({ score: shortAnswerItem.score, by: teacherA, confirmed: false })
    const t = await db.query.attempts.findFirst({ where: eq(attempts.id, a.attemptId) })
    expect(t?.totalScore).toBe(shortAnswerItem.score)

    const b = await attemptFor(teacherA)
    const conf = await teacherGrade(db, teacherA, b.responseId, { confirm: true })
    expect(conf).toMatchObject({ ok: true, score: 1 })
    const rb = await db.query.responses.findFirst({ where: eq(responses.id, b.responseId) })
    expect((rb?.gradeDetail as { teacher?: { confirmed: boolean } }).teacher?.confirmed).toBe(true)
    expect(rb?.feedback).toBe('AI 评语') // 未传 feedback 则保留

    const c = await attemptFor(teacherA)
    expect(await teacherGrade(db, teacherA, c.responseId, { score: 1.26 })).toMatchObject({ ok: true, score: 1.5 })
  })

  it('没有 AI 分时不能只确认;别的老师改不了;客观题也可改分并写 verdict', async () => {
    const a = await attemptFor(teacherA, { score: null, gradeDetail: { verdict: 'needs_review', ai: { error: 'ai_not_configured' } } })
    expect(await teacherGrade(db, teacherA, a.responseId, { confirm: true })).toMatchObject({ ok: false, code: 'no_score' })
    expect(await teacherGrade(db, teacherB, a.responseId, { score: 1 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await teacherGrade(db, teacherA, a.responseId, { score: 1 })).toMatchObject({ ok: true, score: 1 })

    const f = await attemptFor(teacherA, { itemId: fillItem.id, score: 0, gradeDetail: { verdict: 'error' } })
    expect(await teacherGrade(db, teacherA, f.responseId, { score: fillItem.score })).toMatchObject({ ok: true, score: fillItem.score })
    const rf = await db.query.responses.findFirst({ where: eq(responses.id, f.responseId) })
    expect((rf?.gradeDetail as { verdict: string }).verdict).toBe('correct')
  })
})
