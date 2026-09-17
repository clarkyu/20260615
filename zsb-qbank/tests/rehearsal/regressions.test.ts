import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray, asc } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import { assignments, attempts, classMembers, classes, items, papers, responses, users } from '@/lib/db/schema'
import { ruleDraftToPaper } from '@/lib/import/draft'
import { PaperHasResponsesError, responseCountOf, upsertPaper } from '@/lib/db/import-paper'
import { assemblePaper } from '@/lib/db/queries'
import { createClassWithCode } from '@/lib/db/assignments'
import { submitAttempt, sweepOverdueExams } from '@/lib/db/submit'
import { SUBMIT_GRACE_MS } from '@/lib/grading/deadline'
import { loadAssignmentStats } from '@/lib/db/stats'
import type { RuleDraft } from '@/lib/import/rules'
import { paperSchema } from '@/lib/schema/paper'

// 上线预演里手动抓到的问题,固化成用例 —— 以后不用靠人跑一遍才发现。
// 需要已迁移 + 已种子的 DATABASE_URL。

const url = process.env.DATABASE_URL
const PAPER = 'hubei-zsb-english-2025'

describe.skipIf(!url)('预演回归 · 导入的卷学生拿得到题(D45)', () => {
  let db: Db
  const PID = `rehearsal-import-${Date.now()}`

  beforeAll(() => {
    db = getDb()
  })
  afterAll(async () => {
    await db.delete(papers).where(eq(papers.id, PID)) // 级联删 sections / groups / items
  })

  it('规则草稿 → 保存 → 学生组卷:题数与草稿一致,不是 0', async () => {
    // 这条盯的是 2026-09-15 的线上级坑:导入的小题曾存成 draft,而 assemblePaper 只认 approved,
    // 于是「导入 → 发布 → 布置」之后学生打开是一份 0 题的空卷,试卷列表却显示有题。
    const rule: RuleDraft = {
      title: '回归用卷',
      answerKey: null,
      flags: [],
      sections: [
        {
          order: 1,
          code: '一',
          title: '短文填空',
          instructions: '在空白处填入一个适当的单词。',
          itemType: 'fill',
          scorePerItem: 2,
          totalScore: 4,
          flags: [],
          groups: [
            {
              order: 1,
              kind: 'cloze',
              frame: 'It is the {{1}} city in the country, and it {{2}} fast.',
              stimulus: null,
              flags: [],
              items: [
                { number: 1, type: 'fill', content: { blank: 1, maxWords: 1 }, flags: [] },
                { number: 2, type: 'fill', content: { blank: 2, maxWords: 1, hint: 'grow' }, flags: [] },
              ],
            },
          ],
        },
      ],
    } as unknown as RuleDraft

    const { paper } = ruleDraftToPaper(rule, { id: PID, title: '回归用卷', year: 2026, region: '湖北', durationMinutes: 120 })
    const draftItemCount = paper.sections.flatMap((s) => s.groups.flatMap((g) => g.items)).length
    expect(draftItemCount).toBe(2)

    await upsertPaper(db, paper)

    // 学生开卷走的就是 assemblePaper(只认 approved)
    const assembled = await assemblePaper(db, PID)
    expect(assembled).toBeTruthy()
    const served = assembled!.sections.flatMap((s) => s.groups.flatMap((g) => g.items)).length
    expect(served).toBe(draftItemCount)
    expect(served).toBeGreaterThan(0)

    // 试卷本身仍是草稿:学生看不看得到由教师点「发布」把关(D7)
    const row = await db.query.papers.findFirst({ where: eq(papers.id, PID) })
    expect(row?.status).toBe('draft')
  })
})

describe.skipIf(!url)('预演回归 · 学情数字与独立算法一致', () => {
  let db: Db
  let teacherId: string
  let assignmentId: string
  const userIds: string[] = []
  const classIds: string[] = []
  const attemptIds: string[] = []
  const RUN = `${Date.now()}`
  const N = 4 // 4 人交卷,够验分母与计数口径
  /** itemId → 按作答模式手算的期望 */
  const expected = new Map<string, { number: number; objective: boolean; answered: number; correct: number }>()

  beforeAll(async () => {
    db = getDb()
    const mk = async (role: 'teacher' | 'student', tag: string) => {
      const [u] = await db.insert(users).values({ casdoorSub: `rehearsal-${tag}-${RUN}`, name: `R${tag}`, role }).returning({ id: users.id })
      userIds.push(u!.id)
      return u!.id
    }
    teacherId = await mk('teacher', 'T')
    const cls = await createClassWithCode(db, { name: `回归班 ${RUN}`, teacherId })
    classIds.push(cls.id)
    const [a] = await db.insert(assignments).values({ classId: cls.id, paperId: PAPER, mode: 'exam', title: `回归任务 ${RUN}`, createdBy: teacherId }).returning({ id: assignments.id })
    assignmentId = a!.id

    // 只用客观填空题:判分确定、不依赖 AI,期望值可以手算
    const fillItems = (
      await db.select({ id: items.id, number: items.number, answer: items.answer, type: items.type }).from(items).where(eq(items.paperId, PAPER)).orderBy(asc(items.number))
    )
      .filter((r) => r.type === 'fill')
      .slice(0, 5)
    for (const it of fillItems) expected.set(it.id, { number: it.number, objective: true, answered: 0, correct: 0 })

    for (let i = 0; i < N; i++) {
      const sid = await mk('student', `S${i}-${RUN}`)
      await db.insert(classMembers).values({ classId: cls.id, userId: sid })
      const [at] = await db.insert(attempts).values({ userId: sid, paperId: PAPER, assignmentId, mode: 'exam', status: 'in_progress' }).returning()
      attemptIds.push(at!.id)
      for (const [j, it] of fillItems.entries()) {
        const blank = (i + j) % 5 === 0 // 每 5 个留一个空不答
        const wrong = !blank && (i + j) % 2 === 0
        if (blank) continue
        const accepted = (it.answer as { accepted?: string[] }).accepted?.[0] ?? 'x'
        await db.insert(responses).values({
          attemptId: at!.id,
          itemId: it.id,
          answer: { type: 'text', value: wrong ? `zz-${i}-${j}` : accepted },
          clientUpdatedAt: new Date(),
          timeSpentMs: 4000 + i * 1000,
        })
        const e = expected.get(it.id)!
        e.answered++
        if (!wrong) e.correct++
      }
      const fresh = await db.query.attempts.findFirst({ where: eq(attempts.id, at!.id) })
      await submitAttempt(db, fresh!)
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

  it('逐题的已交 / 作答 / 正确数与手算一致(聚合口径漂了就会红)', async () => {
    const out = await loadAssignmentStats(db, teacherId, assignmentId)
    expect(out).toBeTruthy()
    for (const [itemId, e] of expected) {
      const got = out!.stats.items.find((i) => i.itemId === itemId)
      expect(got, `题 ${e.number} 不在学情里`).toBeTruthy()
      expect(got!.submitted, `题 ${e.number} 的已交人数`).toBe(N)
      expect(got!.answered, `题 ${e.number} 的作答数`).toBe(e.answered)
      expect(got!.correct, `题 ${e.number} 的正确数`).toBe(e.correct)
      expect(got!.rate, `题 ${e.number} 的正确率`).toBe(Math.round((e.correct / N) * 1000) / 1000)
      expect(got!.timeSamples, `题 ${e.number} 的用时样本数`).toBe(e.answered)
    }
  })

  it('学生总分 = 其各题得分之和;矩阵宽度 = 题数', async () => {
    const out = await loadAssignmentStats(db, teacherId, assignmentId)
    const st = out!.stats
    expect(st.students.every((s) => s.scores.length === st.items.length)).toBe(true)
    for (const s of st.students.filter((x) => x.totalScore !== null)) {
      const sum = s.scores.reduce<number>((n, x) => n + (x ?? 0), 0)
      expect(Math.abs(sum - (s.totalScore ?? 0)), `${s.name} 的总分`).toBeLessThan(0.01)
    }
  })
})

describe.skipIf(!url)('预演回归 · 逾期未交的考试会被清扫掉(硬约束 6 / §9.5)', () => {
  let db: Db
  const userIds: string[] = []
  const attemptIds: string[] = []
  const RUN = `${Date.now()}`

  beforeAll(() => {
    db = getDb()
  })
  afterAll(async () => {
    if (attemptIds.length) {
      await db.delete(responses).where(inArray(responses.attemptId, attemptIds))
      await db.delete(attempts).where(inArray(attempts.id, attemptIds))
    }
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  })

  it('过了截止 + 60 秒宽限的自动交卷;宽限内的不动', async () => {
    // 学生把页面一关就再也不打开(手机没电、退出微信),客户端的到点自动交卷根本没机会跑。
    // 这时只剩服务端这一层兜底:它要是不灵,这份卷会永远停在「作答中」,老师那边永远等不到成绩。
    const mk = async (tag: string, deadlineMs: number) => {
      const [u] = await db.insert(users).values({ casdoorSub: `sweep-${tag}-${RUN}`, name: `S${tag}`, role: 'student' }).returning({ id: users.id })
      userIds.push(u!.id)
      const [a] = await db
        .insert(attempts)
        .values({ userId: u!.id, paperId: PAPER, mode: 'exam', status: 'in_progress', deadlineAt: new Date(Date.now() + deadlineMs) })
        .returning({ id: attempts.id })
      attemptIds.push(a!.id)
      return a!.id
    }
    const overdue = await mk('overdue', -(SUBMIT_GRACE_MS + 30_000)) // 截止 + 宽限都过了
    const inGrace = await mk('grace', -(SUBMIT_GRACE_MS - 30_000)) // 过了截止但还在宽限内
    const running = await mk('running', 30 * 60_000) // 还在考

    await sweepOverdueExams(db)

    const status = async (id: string) => (await db.query.attempts.findFirst({ where: eq(attempts.id, id) }))!
    const swept = await status(overdue)
    expect(swept.status, '逾期未交的应当被自动交卷').not.toBe('in_progress')
    // 老师要能一眼看出这份是系统代交的,不是学生自己点的
    expect((swept.clientMeta as { autoSubmitted?: boolean } | null)?.autoSubmitted).toBe(true)

    expect((await status(inGrace)).status, '还在 60 秒宽限内的不能提前收走').toBe('in_progress')
    expect((await status(running)).status, '还在考的更不能动').toBe('in_progress')
  })
})

// 种子脚本能不能删掉学生的卷子(D79)。
//
// 2026-09-17 实测:库里已有 5 条作答时跑一次 `pnpm seed`,作答变 0 行,attempt 还在 ——
// 脚本照常打印「导入完成」「断言通过」。`responses.item_id` 对 `items.id` 是
// ON DELETE CASCADE,整树重建一路级联;而「有作答就拒绝重建」那道门当时只写在
// `PUT /api/teacher/papers/:id` 里,种子脚本直连 upsertPaper,什么都继承不到。
//
// 这里守的是那道门搬到了删数据的那一层:默认拒绝,要毁得显式说。
describe.skipIf(!url)('预演回归 · 整卷重建不许悄悄删掉学生作答(D79)', () => {
  let db: Db
  const PID = `rehearsal-guard-${Date.now()}`
  let userId = ''

  // 从种子卷裁一份最小卷:结构由 paperSchema 保证合法,不用手搓一堆非空列
  const seedPaper = paperSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', 'seed', 'paper-2025-hubei-english.json'), 'utf-8')))
  const paper = (title: string) => {
    const sec = structuredClone(seedPaper.sections[0]!)
    sec.groups = [sec.groups[0]!]
    sec.groups[0]!.items = [sec.groups[0]!.items[0]!]
    return { ...structuredClone(seedPaper), id: PID, title, status: 'draft' as const, totalScore: sec.groups[0]!.items[0]!.score, sections: [sec] }
  }

  beforeAll(async () => {
    db = getDb()
    const [u] = await db.insert(users).values({ casdoorSub: `guard-${PID}`, name: '回归学生', role: 'student' }).returning({ id: users.id })
    userId = u!.id
  })
  afterAll(async () => {
    // attempts 对 papers 没有级联,得先删(作答已被 --force 那步连带删掉)
    await db.delete(attempts).where(eq(attempts.paperId, PID))
    await db.delete(papers).where(eq(papers.id, PID))
    if (userId) await db.delete(users).where(eq(users.id, userId))
  })

  it('有作答时默认拒绝重建,且一行都不动;--force 那条路才会真的删', async () => {
    await upsertPaper(db, paper('第一版'))
    const it1 = await db.query.items.findFirst({ where: eq(items.paperId, PID) })
    const [a] = await db.insert(attempts).values({ userId, paperId: PID, mode: 'practice' }).returning({ id: attempts.id })
    await db.insert(responses).values({ attemptId: a!.id, itemId: it1!.id, answer: { type: 'text', value: '学生写的' }, clientUpdatedAt: new Date(), score: 2 })

    // 没作答之前能重建(CI 与全新库走的就是这条路);有作答之后拒绝
    await expect(upsertPaper(db, paper('第二版'))).rejects.toBeInstanceOf(PaperHasResponsesError)
    expect(await responseCountOf(db, PID)).toBe(1)
    // 拒绝是无损的:题面也没被改掉一半
    expect((await db.query.papers.findFirst({ where: eq(papers.id, PID) }))?.title).toBe('第一版')

    // 显式说了才毁 —— 这条同时证明上面的「拒绝」不是因为 upsertPaper 根本跑不动
    await upsertPaper(db, paper('第三版'), { allowDestroyingResponses: true })
    expect(await responseCountOf(db, PID)).toBe(0)
    expect((await db.query.papers.findFirst({ where: eq(papers.id, PID) }))?.title).toBe('第三版')
  })
})
