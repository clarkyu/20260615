import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db/client'
import { aiJobs, attempts, items, responses, reviewCards, trainingProgress, users } from '@/lib/db/schema'
import { answerTraining, dailyPlan, dueReviews, myStats, pickTrainingItems, todaysTrainingAttempt } from '@/lib/db/training'
import { enqueueGenerateJob, processAiJobs, type AiModels } from '@/lib/db/ai-jobs'
import type { AiCaller, AiChatRequest } from '@/lib/ai/client'
import { assemblePaper } from '@/lib/db/queries'
import { DAY_MS } from '@/lib/training/srs'

// M6 训练模式集成用例(真库):抽题只抽已审核题、复习优先;作答即判并更新脚手架 / 复习卡 / 每日进度;
// 错题次日出现在复习;AI 变式草稿不被抽到,通过后才被抽到。需要已迁移 + 已种子的 DATABASE_URL。

const url = process.env.DATABASE_URL
const PAPER = 'hubei-zsb-english-2025'
const MODELS: AiModels = { gradingModel: 'fake', authoringModel: 'fake' }

describe.skipIf(!url)('训练模式(真库)', () => {
  let db: Db
  let userId: string
  const userIds: string[] = []
  const createdItems: string[] = []
  const RUN = `${Date.now()}`
  let fill1: typeof items.$inferSelect

  beforeAll(async () => {
    db = getDb()
    const [u] = await db.insert(users).values({ casdoorSub: `test-m6-${RUN}`, name: 'M6 学生', role: 'student' }).returning({ id: users.id })
    userId = u!.id
    userIds.push(userId)
    fill1 = (await db.query.items.findFirst({ where: and(eq(items.paperId, PAPER), eq(items.number, 1)) }))!
  })
  afterAll(async () => {
    const ts = await db.select({ id: attempts.id }).from(attempts).where(inArray(attempts.userId, userIds))
    if (ts.length) {
      await db.delete(responses).where(inArray(responses.attemptId, ts.map((t) => t.id)))
      await db.delete(attempts).where(inArray(attempts.id, ts.map((t) => t.id)))
    }
    if (createdItems.length) await db.delete(items).where(inArray(items.id, createdItems))
    await db.delete(users).where(inArray(users.id, userIds)) // training_progress / review_cards 级联
  })

  it('抽题:只抽已审核可训练题,带脚手架提示且不带答案 / 干扰项', async () => {
    const got = await pickTrainingItems(db, userId, { mode: 'targeted', type: 'fill', count: 5 })
    expect(got.length).toBe(5)
    for (const v of got) {
      expect(v.type).toBe('fill')
      expect(JSON.stringify(v)).not.toContain('"accepted"')
      expect(v.content).not.toHaveProperty('distractors')
      expect(v.scaffold).not.toBeNull()
      expect(v.scaffold!.level).toBe(2) // 没有干扰项 → 一级退化为二级(首字母)
      expect(v.scaffold!.mask).toMatch(/^([A-Za-z] |_$)/)
      expect(v.contextSnippet).toBeTruthy()
    }
    const tagged = await pickTrainingItems(db, userId, { mode: 'targeted', tags: ['不存在的标签'], count: 5 })
    expect(tagged).toEqual([])
  })

  it('作答:答错建复习卡(明天到期)、脚手架降级、进错题本;答对升级;今日进度更新', async () => {
    const now = new Date('2026-09-14T02:00:00Z')
    const wrong = await answerTraining(db, userId, { itemId: fill1.id, answer: { type: 'text', value: `zzz-${RUN}` } }, now)
    expect('error' in wrong).toBe(false)
    if ('error' in wrong) return
    expect(wrong.verdict).toBe('wrong')
    expect(wrong.accepted).toEqual(['biggest'])
    expect(wrong.review).toMatchObject({ intervalDays: 1 })
    expect(new Date(wrong.review!.dueAt).getTime() - now.getTime()).toBe(DAY_MS)
    expect(wrong.scaffold).toMatchObject({ level: 1, off: false })

    const card = await db.query.reviewCards.findFirst({ where: and(eq(reviewCards.userId, userId), eq(reviewCards.itemId, fill1.id)) })
    expect(card?.lapses).toBe(1)
    // 明天到期:今天的复习列表里没有,明天有
    expect((await dueReviews(db, userId, now)).due.map((d) => d.itemId)).not.toContain(fill1.id)
    expect((await dueReviews(db, userId, new Date(now.getTime() + DAY_MS + 1000))).due.map((d) => d.itemId)).toContain(fill1.id)
    // 明天的「复习」抽题把它排在前面
    const tomorrow = await pickTrainingItems(db, userId, { mode: 'review', count: 5 }, new Date(now.getTime() + DAY_MS + 1000))
    expect(tomorrow[0]?.itemId).toBe(fill1.id)
    expect(tomorrow[0]?.review).toBe(true)

    const right = await answerTraining(db, userId, { itemId: fill1.id, answer: { type: 'text', value: 'biggest' } }, new Date(now.getTime() + DAY_MS + 2000))
    if ('error' in right) throw new Error('unexpected')
    expect(right.verdict).toBe('correct')
    expect(right.review).toMatchObject({ intervalDays: 1 }) // 连对 1 次 → 1 天(阶梯第一档)
    expect(right.scaffold).toMatchObject({ level: 2 })
    const p = await db.query.trainingProgress.findFirst({ where: and(eq(trainingProgress.userId, userId), eq(trainingProgress.itemId, fill1.id)) })
    expect(p).toMatchObject({ attempts: 2, correct: 1, level: 2 })

    const plan = await dailyPlan(db, userId, now)
    expect(plan.newDone).toBe(1)
    const st = await myStats(db, userId, now)
    expect(st.wrongCount).toBe(1)
    expect(st.byType.find((t) => t.type === 'fill')).toMatchObject({ attempts: 2, correct: 1 })
    // 同一天只有一份训练 attempt
    const a1 = await todaysTrainingAttempt(db, userId, now)
    const a2 = await todaysTrainingAttempt(db, userId, new Date(now.getTime() + 3600_000))
    expect(a1.id).toBe(a2.id)
  })

  it('三级连对两次脚手架永久关闭', async () => {
    const it2 = (await db.query.items.findFirst({ where: and(eq(items.paperId, PAPER), eq(items.number, 3)) }))!
    const t0 = new Date('2026-09-14T03:00:00Z')
    const seq = ['started', 'started', 'started', 'started']
    let last: Awaited<ReturnType<typeof answerTraining>> | null = null
    for (let i = 0; i < seq.length; i++) last = await answerTraining(db, userId, { itemId: it2.id, answer: { type: 'text', value: seq[i]! } }, new Date(t0.getTime() + i * 1000))
    if (!last || 'error' in last) throw new Error('unexpected')
    // 1→2→3(连对两次到三级)→三级第一次对→三级第二次对:关闭
    expect(last.scaffold).toMatchObject({ level: 3, off: true })
    const again = await pickTrainingItems(db, userId, { mode: 'targeted', type: 'fill', count: 30 })
    expect(again.find((v) => v.itemId === it2.id)?.scaffold).toEqual({ level: 3, off: true })
  })

  it('AI 变式草稿:入库为 draft、不进试卷装配也不被抽到;通过后才被抽到;干扰项生成可采纳', async () => {
    const fake: AiCaller = async (req: AiChatRequest) => {
      const variants = {
        items: [
          { type: 'fill', content: { blank: 1, hint: 'tall', maxWords: 1, distractors: ['tall', 'taller', 'tallness'] }, contextSnippet: `This is the {{1}} building in town ${RUN}.`, answer: { accepted: ['tallest'] }, explanation: '最高级。', knowledgeTags: ['最高级'], difficulty: 1 },
          { type: 'fill', content: { blank: 1, maxWords: 1, distractors: [] }, contextSnippet: 'no blank here', answer: { accepted: ['x'] }, explanation: '坏', knowledgeTags: [], difficulty: 2 },
        ],
      }
      const text = req.system.includes('变式') ? JSON.stringify(variants) : JSON.stringify({ distractors: ['big', 'bigger', 'biggest', 'bigness'] })
      return { text, model: 'fake', usage: { promptTokens: 1, completionTokens: 1 }, latencyMs: 1 }
    }
    const jobId = await enqueueGenerateJob(db, { itemId: fill1.id, mode: 'variants', count: 3, createdBy: userId })
    expect(await enqueueGenerateJob(db, { itemId: fill1.id, mode: 'variants', count: 3, createdBy: userId })).toBe(jobId) // 复用
    await processAiJobs(db, fake, MODELS, { max: 5 })
    const job = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, jobId) })
    expect(job?.status).toBe('done')
    const result = job?.result as { created: Array<{ id: string; number: number }>; rejected: string[] }
    expect(result.created).toHaveLength(1)
    expect(result.rejected).toEqual(['填空片段缺少 {{1}} 空位'])
    const draftId = result.created[0]!.id
    createdItems.push(draftId)
    const draft = await db.query.items.findFirst({ where: eq(items.id, draftId) })
    expect(draft).toMatchObject({ status: 'draft', origin: 'ai', paperId: PAPER, groupId: fill1.groupId })
    expect(draft!.number).toBeGreaterThan(1000)
    expect((draft!.content as { distractors: string[] }).distractors).toEqual(['tall', 'taller', 'tallness'])

    const paper = await assemblePaper(db, PAPER)
    expect(paper!.sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.id)))).not.toContain(draftId)
    const picked = await pickTrainingItems(db, userId, { mode: 'targeted', type: 'fill', count: 60, tags: ['最高级'] })
    expect(picked.map((v) => v.itemId)).not.toContain(draftId)

    await db.update(items).set({ status: 'approved' }).where(eq(items.id, draftId))
    const picked2 = await pickTrainingItems(db, userId, { mode: 'targeted', type: 'fill', count: 60, tags: ['最高级'] })
    const v = picked2.find((x) => x.itemId === draftId)
    expect(v).toBeTruthy()
    expect(v!.scaffold).toMatchObject({ level: 1 })
    expect(v!.scaffold!.options).toHaveLength(4)
    expect(v!.scaffold!.options).toContain('tallest')

    const dj = await enqueueGenerateJob(db, { itemId: fill1.id, mode: 'distractors', count: 3, createdBy: userId })
    await processAiJobs(db, fake, MODELS, { max: 5 })
    const djob = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, dj) })
    expect((djob?.result as { distractors: string[] }).distractors).toEqual(['big', 'bigger', 'bigness']) // 去掉了答案 biggest
    await db.delete(aiJobs).where(inArray(aiJobs.id, [jobId, dj]))
  })
})
