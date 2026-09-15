import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray, and } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import { attempts, items, responses, users } from '@/lib/db/schema'
import { loadAssignmentStats } from '@/lib/db/stats'
import { createClassWithCode } from '@/lib/db/assignments'
import { assignments, classMembers, classes } from '@/lib/db/schema'

// 逐题用时(SPEC §8 中位用时)落库到学情页的整条链路。需要已迁移 + 已种子的 DATABASE_URL。

const url = process.env.DATABASE_URL
const PAPER = 'hubei-zsb-english-2025'

describe.skipIf(!url)('每题用时(真库)', () => {
  let db: Db
  let teacher: string
  const students: string[] = []
  const userIds: string[] = []
  const classIds: string[] = []
  const attemptIds: string[] = []
  let assignmentId: string
  let fillItems: { id: string; number: number; score: number }[]
  const RUN = `${Date.now()}`

  beforeAll(async () => {
    db = getDb()
    const mk = async (role: 'teacher' | 'student', tag: string) => {
      const [u] = await db.insert(users).values({ casdoorSub: `test-time-${tag}-${RUN}`, name: `T${tag}`, role }).returning({ id: users.id })
      userIds.push(u!.id)
      return u!.id
    }
    teacher = await mk('teacher', 'T')
    for (const i of [1, 2, 3]) students.push(await mk('student', `S${i}`))

    const rows = await db.select({ id: items.id, number: items.number, score: items.score, type: items.type }).from(items).where(eq(items.paperId, PAPER))
    fillItems = rows.filter((r) => r.type === 'fill').slice(0, 2).map(({ id, number, score }) => ({ id, number, score }))

    const c = await createClassWithCode(db, { name: `TIME-${RUN}`, teacherId: teacher })
    classIds.push(c.id)
    const [a] = await db
      .insert(assignments)
      .values({ classId: c.id, paperId: PAPER, mode: 'exam', title: `用时任务 ${RUN}`, createdBy: teacher })
      .returning({ id: assignments.id })
    assignmentId = a!.id

    // 三个学生都交卷:第 1 题分别 10 / 20 / 30 秒(中位 20 秒);第 2 题只有一个人有埋点。
    const times = [10_000, 20_000, 30_000]
    for (const [i, s] of students.entries()) {
      await db.insert(classMembers).values({ classId: c.id, userId: s })
      const [t] = await db
        .insert(attempts)
        .values({ userId: s, paperId: PAPER, assignmentId, mode: 'exam', status: 'submitted', submittedAt: new Date() })
        .returning({ id: attempts.id })
      attemptIds.push(t!.id)
      await db.insert(responses).values({
        attemptId: t!.id,
        itemId: fillItems[0]!.id,
        answer: { type: 'text', value: 'big' },
        clientUpdatedAt: new Date(),
        score: fillItems[0]!.score,
        gradeSource: 'auto',
        gradeDetail: { verdict: 'correct' },
        timeSpentMs: times[i]!,
      })
      await db.insert(responses).values({
        attemptId: t!.id,
        itemId: fillItems[1]!.id,
        answer: { type: 'text', value: 'small' },
        clientUpdatedAt: new Date(),
        score: 0,
        gradeSource: 'auto',
        gradeDetail: { verdict: 'wrong' },
        timeSpentMs: i === 0 ? 7_000 : null, // 另外两人埋点丢了
      })
    }
  })

  afterAll(async () => {
    if (attemptIds.length) {
      await db.delete(responses).where(inArray(responses.attemptId, attemptIds))
      await db.delete(attempts).where(inArray(attempts.id, attemptIds))
    }
    if (classIds.length) {
      await db.delete(assignments).where(inArray(assignments.classId, classIds))
      await db.delete(classMembers).where(inArray(classMembers.classId, classIds))
      await db.delete(classes).where(inArray(classes.id, classIds))
    }
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  })

  it('学情页拿到中位用时与样本数', async () => {
    const out = await loadAssignmentStats(db, teacher, assignmentId)
    expect(out).toBeTruthy()
    const i1 = out!.stats.items.find((i) => i.itemId === fillItems[0]!.id)!
    expect(i1.medianTimeMs).toBe(20_000)
    expect(i1.timeSamples).toBe(3)
  })

  it('埋点丢了的不拿 0 充数:样本数只算有数据的', async () => {
    const out = await loadAssignmentStats(db, teacher, assignmentId)
    const i2 = out!.stats.items.find((i) => i.itemId === fillItems[1]!.id)!
    expect(i2.timeSamples).toBe(1)
    expect(i2.medianTimeMs).toBe(7_000)
  })

  it('用时不影响判分与正确率', async () => {
    const out = await loadAssignmentStats(db, teacher, assignmentId)
    const i1 = out!.stats.items.find((i) => i.itemId === fillItems[0]!.id)!
    expect(i1.correct).toBe(3)
    expect(i1.rate).toBe(1)
  })
})
