import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray, and } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import { aiGradeCache, attempts, items, responses, users, wrongAnswers } from '@/lib/db/schema'
import { acceptedCandidates, bankFacets, listBankItems, resolveCandidates } from '@/lib/db/item-bank'
import { normalizeText } from '@/lib/grading/normalize'

// 题库管理(SPEC §8):筛选 + accepted 候选采纳。需要已迁移 + 已种子的 DATABASE_URL。

const url = process.env.DATABASE_URL
const PAPER = 'hubei-zsb-english-2025'

describe.skipIf(!url)('题库筛选(真库)', () => {
  let db: Db
  beforeAll(() => {
    db = getDb()
  })

  it('不带条件能列出种子卷的小题,并给出总数', async () => {
    const out = await listBankItems(db, { paperId: PAPER })
    expect(out.total).toBeGreaterThan(0)
    expect(out.items.length).toBeGreaterThan(0)
    expect(out.items.every((i) => i.paperId === PAPER)).toBe(true)
    // 带上了所属试卷与大题名,老师才知道这题是哪儿的
    expect(out.items[0]!.paperTitle).toBeTruthy()
  })

  it('按题型筛:只回这一种题型,且条数与 facets 对得上', async () => {
    const facets = await bankFacets(db)
    const fill = facets.types.find((t) => t.type === 'fill')
    expect(fill).toBeTruthy()
    const out = await listBankItems(db, { type: 'fill', limit: 200 })
    expect(out.items.every((i) => i.type === 'fill')).toBe(true)
    expect(out.total).toBe(fill!.n)
  })

  it('按年份、题号筛', async () => {
    const byYear = await listBankItems(db, { year: 2025, limit: 200 })
    expect(byYear.items.every((i) => i.paperYear === 2025)).toBe(true)
    const one = await listBankItems(db, { paperId: PAPER, number: 1 })
    expect(one.total).toBe(1)
    expect(one.items[0]!.number).toBe(1)
  })

  it('筛不到时是空结果,不是报错', async () => {
    const out = await listBankItems(db, { paperId: PAPER, tag: `不存在的标签-${Date.now()}` })
    expect(out).toEqual({ items: [], total: 0 })
  })

  it('分页:limit / offset 不重不漏', async () => {
    const all = await listBankItems(db, { paperId: PAPER, limit: 200 })
    const p1 = await listBankItems(db, { paperId: PAPER, limit: 10, offset: 0 })
    const p2 = await listBankItems(db, { paperId: PAPER, limit: 10, offset: 10 })
    expect(p1.items).toHaveLength(10)
    expect(p1.total).toBe(all.total)
    const ids = new Set([...p1.items, ...p2.items].map((i) => i.id))
    expect(ids.size).toBe(p1.items.length + p2.items.length)
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual(all.items.slice(0, 20).map((i) => i.id))
  })
})

describe.skipIf(!url)('accepted 候选采纳(真库)', () => {
  let db: Db
  let student: string
  let item: { id: string; score: number; number: number }
  let originalAccepted: string[]
  const userIds: string[] = []
  const attemptIds: string[] = []
  const RUN = `${Date.now()}`
  const ANSWER = `have been fond of ${RUN}`

  beforeAll(async () => {
    db = getDb()
    const [u] = await db.insert(users).values({ casdoorSub: `test-bank-${RUN}`, name: 'BankS', role: 'student' }).returning({ id: users.id })
    userIds.push(u!.id)
    student = u!.id
    const row = await db.query.items.findFirst({ where: and(eq(items.paperId, PAPER), eq(items.type, 'translate_c2e_fill')) })
    item = { id: row!.id, score: row!.score, number: row!.number }
    originalAccepted = ((row!.answer as { accepted?: string[] }).accepted ?? []).slice()
  })

  afterAll(async () => {
    if (attemptIds.length) {
      await db.delete(responses).where(inArray(responses.attemptId, attemptIds))
      await db.delete(attempts).where(inArray(attempts.id, attemptIds))
    }
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
    // 把答案键与副作用还原,免得影响别的用例与本地库
    const row = await db.query.items.findFirst({ where: eq(items.id, item.id) })
    await db.update(items).set({ answer: { ...(row!.answer as Record<string, unknown>), accepted: originalAccepted } }).where(eq(items.id, item.id))
    await db.delete(wrongAnswers).where(eq(wrongAnswers.itemId, item.id))
    await db.delete(aiGradeCache).where(eq(aiGradeCache.itemId, item.id))
  })

  async function answer(text: string, score: number) {
    const [t] = await db.insert(attempts).values({ userId: student, paperId: PAPER, mode: 'practice', status: 'submitted', submittedAt: new Date() }).returning({ id: attempts.id })
    attemptIds.push(t!.id)
    await db.insert(responses).values({
      attemptId: t!.id,
      itemId: item.id,
      answer: { type: 'text', value: text },
      clientUpdatedAt: new Date(),
      score,
      gradeSource: 'ai',
      gradeDetail: { verdict: score >= item.score ? 'correct' : 'wrong' },
    })
  }

  it('AI 判满分、答案键里没有的 → 成为候选;AI 判 0 分的不算', async () => {
    await answer(ANSWER, item.score)
    await answer(`totally wrong ${RUN}`, 0)
    const rows = await acceptedCandidates(db, { itemId: item.id })
    const texts = rows[0]?.candidates.map((c) => c.text) ?? []
    expect(texts).toContain(ANSWER)
    expect(texts).not.toContain(`totally wrong ${RUN}`)
  })

  it('采纳后写进答案键、AI 评分缓存作废、候选不再出现', async () => {
    // 先塞一条缓存,证明采纳会清掉它(否则后来的学生还会命中按旧答案键算的判分)
    await db.insert(aiGradeCache).values({ itemId: item.id, answerHash: `h-${RUN}`, result: { score: 0, issues: [] }, model: 'test' }).onConflictDoNothing()

    const out = await resolveCandidates(db, item.id, { adopt: [ANSWER] })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.added).toEqual([ANSWER])

    const row = await db.query.items.findFirst({ where: eq(items.id, item.id) })
    expect((row!.answer as { accepted: string[] }).accepted).toContain(ANSWER)

    const cache = await db.select().from(aiGradeCache).where(eq(aiGradeCache.itemId, item.id))
    expect(cache).toHaveLength(0)

    const after = await acceptedCandidates(db, { itemId: item.id })
    expect(after[0]?.candidates.map((c) => c.text) ?? []).not.toContain(ANSWER)
  })

  it('重复采纳不会在答案键里留两条', async () => {
    const before = await db.query.items.findFirst({ where: eq(items.id, item.id) })
    const n = (before!.answer as { accepted: string[] }).accepted.length
    const out = await resolveCandidates(db, item.id, { adopt: [ANSWER.toUpperCase()] })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.added).toEqual([])
    expect(out.duplicates).toHaveLength(1)
    const after = await db.query.items.findFirst({ where: eq(items.id, item.id) })
    expect((after!.answer as { accepted: string[] }).accepted).toHaveLength(n)
  })

  it('拒绝的记为错答,以后不再作为候选', async () => {
    const BAD = `sort of right ${RUN}`
    await answer(BAD, item.score)
    expect((await acceptedCandidates(db, { itemId: item.id }))[0]?.candidates.map((c) => c.text)).toContain(BAD)

    const out = await resolveCandidates(db, item.id, { reject: [BAD] })
    expect(out.ok).toBe(true)
    const wrong = await db.select().from(wrongAnswers).where(and(eq(wrongAnswers.itemId, item.id), eq(wrongAnswers.normalizedAnswer, normalizeText(BAD))))
    expect(wrong).toHaveLength(1)

    const after = await acceptedCandidates(db, { itemId: item.id })
    expect(after[0]?.candidates.map((c) => c.text) ?? []).not.toContain(BAD)
  })

  it('不是汉译英填空的题拒绝处理', async () => {
    const other = await db.query.items.findFirst({ where: and(eq(items.paperId, PAPER), eq(items.type, 'fill')) })
    const out = await resolveCandidates(db, other!.id, { adopt: ['x'] })
    expect(out.ok).toBe(false)
  })
})
