import { and, asc, desc, eq, gte, inArray, lt, lte, notInArray, sql } from 'drizzle-orm'
import type { Db } from './client'
import { attempts, groups, items, papers, responses, reviewCards, trainingProgress } from './schema'
import { parseItemRow } from './item-parse'
import { enqueueGradeJob, recordWrongAnswer, recomputeAttemptScore } from './ai-jobs'
import { gradeObjective, isObjectiveType } from '@/lib/grading/objective'
import { studentAnswerSchema, type Item, type StudentAnswer } from '@/lib/schema/paper'
import { nextReview, startOfDayShanghai, type ReviewCardState } from '@/lib/training/srs'
import { INITIAL_SCAFFOLD, SCAFFOLD_TYPES, nextScaffold, scaffoldHint, type ScaffoldHint, type ScaffoldLevel, type ScaffoldState } from '@/lib/training/scaffold'
import { sentenceAround } from '@/lib/import/rules'

// 训练模式(SPEC §6 / §10 M6):抽题(今日任务 / 复习 / 专项)、逐题即判、复习卡与脚手架状态更新。
// 训练作答只存服务端(§6「保存:服务端」):每人每天一份 mode=training 的 attempt,responses 记最新一次作答。
// 只抽 status=approved 的小题(AI 变式草稿不经审核不会被抽到)。

export const TRAINABLE_TYPES = ['fill', 'translate_c2e_fill', 'reorder'] as const
export const DAILY_NEW_TARGET = 10
export const DAILY_REVIEW_CAP = 20

export type TrainMode = 'daily' | 'review' | 'targeted'

export interface TrainingItemView {
  itemId: string
  number: number
  type: string
  score: number
  /** 剥离答案与干扰项后的内容 */
  content: Record<string, unknown>
  contextSnippet: string | null
  knowledgeTags: string[]
  difficulty: number
  paperTitle: string | null
  /** 展开全文用:材料与框架(无答案) */
  group: { kind: string; stimulus: { kind: string; title?: string; body: string } | null; frame: string | null }
  scaffold: ScaffoldHint | null
  /** 这题是不是到期复习 */
  review: boolean
  /** 之前练过几次 / 对几次 */
  progress: { attempts: number; correct: number }
}

function stripContent(content: unknown): Record<string, unknown> {
  const c = { ...(content as Record<string, unknown>) }
  delete c.distractors
  return c
}
function firstAnswer(item: Item): string {
  if ('accepted' in item.answer) return item.answer.accepted[0] ?? ''
  if ('reference' in item.answer) return item.answer.reference
  if ('correct' in item.answer) return item.answer.correct[0] ?? ''
  return ''
}
function scaffoldStateOf(p: typeof trainingProgress.$inferSelect | undefined): ScaffoldState {
  if (!p) return INITIAL_SCAFFOLD
  return { level: Math.min(3, Math.max(1, p.level)) as ScaffoldLevel, l3Streak: p.l3Streak, off: p.scaffoldOff }
}

/** 今天(北京时间)的训练 attempt;没有就建一份。 */
export async function todaysTrainingAttempt(db: Db, userId: string, now = new Date()): Promise<typeof attempts.$inferSelect> {
  const dayStart = startOfDayShanghai(now)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const existing = await db.query.attempts.findFirst({
    where: and(eq(attempts.userId, userId), eq(attempts.mode, 'training'), gte(attempts.startedAt, dayStart), lt(attempts.startedAt, dayEnd)),
    orderBy: desc(attempts.startedAt),
  })
  if (existing) return existing
  const [row] = await db.insert(attempts).values({ userId, mode: 'training', paperId: null, startedAt: now }).returning()
  if (!row) throw new Error('创建训练记录失败')
  return row
}

/** 今日已在训练里作答过的小题 id(用于每日任务进度与抽题去重)。 */
export async function answeredToday(db: Db, userId: string, now = new Date()): Promise<Set<string>> {
  return new Set((await todaysResponses(db, userId, now)).map((r) => r.itemId))
}

async function todaysResponses(db: Db, userId: string, now: Date): Promise<Array<{ itemId: string; review: boolean }>> {
  const dayStart = startOfDayShanghai(now)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const t = await db.query.attempts.findFirst({
    where: and(eq(attempts.userId, userId), eq(attempts.mode, 'training'), gte(attempts.startedAt, dayStart), lt(attempts.startedAt, dayEnd)),
    orderBy: desc(attempts.startedAt),
  })
  if (!t) return []
  const rows = await db.select({ itemId: responses.itemId, detail: responses.gradeDetail }).from(responses).where(eq(responses.attemptId, t.id))
  return rows.map((r) => ({ itemId: r.itemId, review: (r.detail as { training?: { review?: boolean } } | null)?.training?.review === true }))
}

export interface PickOptions {
  mode: TrainMode
  type?: string | null
  tags?: string[]
  count?: number
  exclude?: string[]
}

/**
 * 抽题。
 *   review   :到期复习卡(dueAt ≤ now),按到期先后
 *   targeted :按题型 / 知识点筛选;先没练过的、再错得多的,最后随机
 *   daily    :到期复习(≤ 20)+ 新题(10 题,优先最薄弱题型),扣掉今天已做过的
 */
export async function pickTrainingItems(db: Db, userId: string, opts: PickOptions, now = new Date()): Promise<TrainingItemView[]> {
  const count = Math.min(Math.max(opts.count ?? 10, 1), 30)
  const exclude = new Set(opts.exclude ?? [])
  const doneToday = opts.mode === 'daily' ? await answeredToday(db, userId, now) : new Set<string>()

  const dueRows = await db
    .select({ itemId: reviewCards.itemId, dueAt: reviewCards.dueAt })
    .from(reviewCards)
    .innerJoin(items, eq(items.id, reviewCards.itemId))
    .where(and(eq(reviewCards.userId, userId), lte(reviewCards.dueAt, now), eq(items.status, 'approved'), inArray(items.type, [...TRAINABLE_TYPES])))
    .orderBy(asc(reviewCards.dueAt))
  const dueIds = dueRows.map((r) => r.itemId).filter((id) => !exclude.has(id) && !doneToday.has(id))

  let chosen: string[] = []
  if (opts.mode === 'review') chosen = dueIds.slice(0, count)
  else if (opts.mode === 'daily') {
    chosen = dueIds.slice(0, Math.min(DAILY_REVIEW_CAP, count))
    const remain = count - chosen.length
    if (remain > 0) chosen.push(...(await pickNew(db, userId, { type: await weakestType(db, userId), tags: [], count: remain, exclude: new Set([...exclude, ...doneToday, ...chosen]) })))
  } else {
    chosen = await pickNew(db, userId, { type: opts.type ?? null, tags: opts.tags ?? [], count, exclude: new Set([...exclude]) })
  }
  if (chosen.length === 0) return []
  return loadViews(db, userId, chosen, new Set(dueIds))
}

/** 最薄弱题型:训练进度里正确率最低的可训练题型(没数据则 null → 不限)。 */
export async function weakestType(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ type: items.type, attempts: sql<number>`sum(${trainingProgress.attempts})::int`, correct: sql<number>`sum(${trainingProgress.correct})::int` })
    .from(trainingProgress)
    .innerJoin(items, eq(items.id, trainingProgress.itemId))
    .where(eq(trainingProgress.userId, userId))
    .groupBy(items.type)
  let worst: { type: string; rate: number } | null = null
  for (const r of rows) {
    if (!r.attempts) continue
    const rate = r.correct / r.attempts
    if (!worst || rate < worst.rate) worst = { type: r.type, rate }
  }
  return worst?.type ?? null
}

async function pickNew(db: Db, userId: string, f: { type: string | null; tags: string[]; count: number; exclude: Set<string> }): Promise<string[]> {
  const conds = [eq(items.status, 'approved'), inArray(items.type, [...TRAINABLE_TYPES])]
  if (f.type && (TRAINABLE_TYPES as readonly string[]).includes(f.type)) conds.push(eq(items.type, f.type))
  if (f.tags.length) conds.push(sql`${items.knowledgeTags} && ${sql.raw(`ARRAY[${f.tags.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`)}`)
  if (f.exclude.size) conds.push(notInArray(items.id, [...f.exclude]))
  // 排序:没练过的在前,再按正确率低的、练得少的;同档随机
  const rows = await db
    .select({ id: items.id })
    .from(items)
    .leftJoin(trainingProgress, and(eq(trainingProgress.itemId, items.id), eq(trainingProgress.userId, userId)))
    .where(and(...conds))
    .orderBy(
      sql`(${trainingProgress.itemId} is null) desc`,
      sql`case when coalesce(${trainingProgress.attempts}, 0) = 0 then 0 else ${trainingProgress.correct}::float / ${trainingProgress.attempts} end asc`,
      sql`coalesce(${trainingProgress.attempts}, 0) asc`,
      sql`random()`,
    )
    .limit(f.count)
  return rows.map((r) => r.id)
}

async function loadViews(db: Db, userId: string, ids: string[], dueSet: Set<string>): Promise<TrainingItemView[]> {
  const rows = await db
    .select({ it: items, g: groups, paperTitle: papers.title })
    .from(items)
    .innerJoin(groups, eq(items.groupId, groups.id))
    .leftJoin(papers, eq(items.paperId, papers.id))
    .where(inArray(items.id, ids))
  const progress = await db.select().from(trainingProgress).where(and(eq(trainingProgress.userId, userId), inArray(trainingProgress.itemId, ids)))
  const progressById = new Map(progress.map((p) => [p.itemId, p]))
  const byId = new Map(rows.map((r) => [r.it.id, r]))
  const out: TrainingItemView[] = []
  for (const id of ids) {
    const r = byId.get(id)
    if (!r) continue
    const item = parseItemRow(r.it)
    if (!item) continue
    const p = progressById.get(id)
    const stim = (r.g.stimulus && typeof r.g.stimulus === 'object' ? r.g.stimulus : null) as { kind: string; title?: string; body: string } | null
    const snippet = item.contextSnippet ?? (item.type === 'fill' && r.g.frame ? (sentenceAround(r.g.frame, item.number) ?? null) : null)
    const distractors = 'distractors' in item.content && Array.isArray(item.content.distractors) ? item.content.distractors : undefined
    out.push({
      itemId: id,
      number: item.number,
      type: item.type,
      score: item.score,
      content: stripContent(item.content),
      contextSnippet: snippet,
      knowledgeTags: item.knowledgeTags,
      difficulty: item.difficulty,
      paperTitle: r.paperTitle,
      group: { kind: r.g.kind, stimulus: stim, frame: r.g.frame },
      scaffold: SCAFFOLD_TYPES.has(item.type) ? scaffoldHint(scaffoldStateOf(p), firstAnswer(item), distractors, `${userId}:${id}`) : null,
      review: dueSet.has(id),
      progress: { attempts: p?.attempts ?? 0, correct: p?.correct ?? 0 },
    })
  }
  return out
}

export interface TrainingFeedback {
  itemId: string
  verdict: string
  score: number
  fullScore: number
  accepted: string[]
  explanation: string | null
  commonMistakes: string[]
  /** 汉译英未命中词表:已交 AI 兜底,客户端可轮询 /api/attempts/:id/feedback */
  pending?: { attemptId: string; jobId: string }
  review: { dueAt: string; intervalDays: number } | null
  scaffold: ScaffoldState & { hint: ScaffoldHint | null }
}

/**
 * 训练作答:即判(客观规则,§5.2;训练不开容错)→ 写今日训练记录 → 更新脚手架状态与复习卡 →
 * 常见错答计数 → 汉译英未命中交 AI 兜底(异步,不影响即时反馈)。
 */
export async function answerTraining(db: Db, userId: string, input: { itemId: string; answer: StudentAnswer }, now = new Date()): Promise<TrainingFeedback | { error: 'not_found' | 'not_trainable' | 'bad_item' }> {
  const row = await db.query.items.findFirst({ where: eq(items.id, input.itemId) })
  if (!row || row.status !== 'approved') return { error: 'not_found' }
  if (!(TRAINABLE_TYPES as readonly string[]).includes(row.type)) return { error: 'not_trainable' }
  const item = parseItemRow(row)
  if (!item || !isObjectiveType(item.type)) return { error: 'bad_item' }
  const answer = studentAnswerSchema.safeParse(input.answer).data ?? { type: 'text' as const, value: '' }
  const graded = gradeObjective(item, answer)
  const correct = graded.verdict === 'correct'

  // 这次作答是不是「复习」(已有到期复习卡):记进 gradeDetail,每日任务据此区分复习与新题。
  const cardBefore = await db.query.reviewCards.findFirst({ where: and(eq(reviewCards.userId, userId), eq(reviewCards.itemId, row.id)) })
  const isReview = !!cardBefore && cardBefore.dueAt <= now
  const detail = { verdict: graded.verdict, training: { review: isReview } }
  const attempt = await todaysTrainingAttempt(db, userId, now)
  const [resp] = await db
    .insert(responses)
    .values({ attemptId: attempt.id, itemId: row.id, answer, clientUpdatedAt: now, score: graded.score, gradeSource: 'auto', gradeDetail: detail, needsReview: false })
    .onConflictDoUpdate({
      target: [responses.attemptId, responses.itemId],
      set: { answer, clientUpdatedAt: now, updatedAt: now, score: graded.score, gradeSource: 'auto', gradeDetail: detail, needsReview: false, feedback: null },
    })
    .returning({ id: responses.id })

  // 脚手架状态
  const prev = await db.query.trainingProgress.findFirst({ where: and(eq(trainingProgress.userId, userId), eq(trainingProgress.itemId, row.id)) })
  const nextState = SCAFFOLD_TYPES.has(item.type) ? nextScaffold(scaffoldStateOf(prev), correct) : scaffoldStateOf(prev)
  await db
    .insert(trainingProgress)
    .values({ userId, itemId: row.id, level: nextState.level, l3Streak: nextState.l3Streak, scaffoldOff: nextState.off, attempts: 1, correct: correct ? 1 : 0, lastResult: graded.verdict, lastAt: now })
    .onConflictDoUpdate({
      target: [trainingProgress.userId, trainingProgress.itemId],
      set: {
        level: nextState.level,
        l3Streak: nextState.l3Streak,
        scaffoldOff: nextState.off,
        attempts: sql`${trainingProgress.attempts} + 1`,
        correct: sql`${trainingProgress.correct} + ${correct ? 1 : 0}`,
        lastResult: graded.verdict,
        lastAt: now,
      },
    })

  // 复习卡(错题本)
  const card = cardBefore
  const cardState: ReviewCardState | null = card ? { dueAt: card.dueAt, intervalDays: card.intervalDays, ease: card.ease, streak: card.streak, lapses: card.lapses, lastResult: card.lastResult } : null
  const nextCard = nextReview(cardState, correct, now)
  if (nextCard) {
    await db
      .insert(reviewCards)
      .values({ userId, itemId: row.id, ...nextCard })
      .onConflictDoUpdate({ target: [reviewCards.userId, reviewCards.itemId], set: { ...nextCard } })
  }

  // 常见错答 / AI 兜底
  let pending: TrainingFeedback['pending']
  if (graded.verdict === 'wrong' && graded.aiFallbackEligible && resp) {
    const out = await enqueueGradeJob(db, { attemptId: attempt.id, responseId: resp.id, itemId: row.id, mode: 'c2e_fallback' })
    if (out.jobId) pending = { attemptId: attempt.id, jobId: out.jobId }
  } else if (graded.verdict === 'wrong') {
    await recordWrongAnswer(db, row.id, graded.normalized)
  }
  await recomputeAttemptScore(db, attempt.id)

  const accepted = 'accepted' in item.answer ? item.answer.accepted : 'correct' in item.answer ? item.answer.correct : []
  const distractors = 'distractors' in item.content && Array.isArray(item.content.distractors) ? item.content.distractors : undefined
  return {
    itemId: row.id,
    verdict: pending ? 'pending' : graded.verdict,
    score: graded.score,
    fullScore: item.score,
    accepted: pending ? [] : accepted,
    explanation: pending ? null : (item.explanation ?? null),
    commonMistakes: [],
    pending,
    review: nextCard ? { dueAt: nextCard.dueAt.toISOString(), intervalDays: nextCard.intervalDays } : null,
    scaffold: { ...nextState, hint: SCAFFOLD_TYPES.has(item.type) ? scaffoldHint(nextState, firstAnswer(item), distractors, `${userId}:${row.id}`) : null },
  }
}

export interface DailyPlan {
  date: string
  due: number
  dueDone: number
  newTarget: number
  newDone: number
  weakestType: string | null
  wrongTotal: number
}

/** 每日任务:今日到期复习 + 10 道新题;已做进度按今天的训练记录算。 */
export async function dailyPlan(db: Db, userId: string, now = new Date()): Promise<DailyPlan> {
  const done = await todaysResponses(db, userId, now)
  const due = await db
    .select({ itemId: reviewCards.itemId })
    .from(reviewCards)
    .innerJoin(items, eq(items.id, reviewCards.itemId))
    .where(and(eq(reviewCards.userId, userId), lte(reviewCards.dueAt, now), eq(items.status, 'approved'), inArray(items.type, [...TRAINABLE_TYPES])))
  const dueIds = new Set(due.map((d) => d.itemId))
  // 今天做过的题里,作答时带「到期复习卡」的算已复习(做完后 dueAt 已推后,不在 due 列表里),其余算新题
  const dueDone = done.filter((d) => d.review && !dueIds.has(d.itemId)).length
  const newDone = done.filter((d) => !d.review).length
  const [wrong] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewCards).where(eq(reviewCards.userId, userId))
  return {
    date: startOfDayShanghai(now).toISOString(),
    due: dueIds.size + dueDone,
    dueDone,
    newTarget: DAILY_NEW_TARGET,
    newDone: Math.min(DAILY_NEW_TARGET, newDone),
    weakestType: await weakestType(db, userId),
    wrongTotal: wrong?.n ?? 0,
  }
}

export interface ReviewListItem {
  itemId: string
  number: number
  type: string
  paperTitle: string | null
  snippet: string | null
  dueAt: Date
  intervalDays: number
  lapses: number
  streak: number
}

/** 到期复习卡列表(GET /api/review)。 */
export async function dueReviews(db: Db, userId: string, now = new Date()): Promise<{ due: ReviewListItem[]; upcoming: number; total: number }> {
  const rows = await db
    .select({ c: reviewCards, it: items, paperTitle: papers.title, frame: groups.frame })
    .from(reviewCards)
    .innerJoin(items, eq(items.id, reviewCards.itemId))
    .innerJoin(groups, eq(items.groupId, groups.id))
    .leftJoin(papers, eq(items.paperId, papers.id))
    .where(and(eq(reviewCards.userId, userId), eq(items.status, 'approved')))
    .orderBy(asc(reviewCards.dueAt))
  const due: ReviewListItem[] = []
  let upcoming = 0
  for (const r of rows) {
    if (r.c.dueAt > now) {
      upcoming++
      continue
    }
    const zh = (r.it.content as { zh?: string }).zh
    const snippet = r.it.contextSnippet ?? (typeof zh === 'string' ? zh : r.frame ? (sentenceAround(r.frame, r.it.number) ?? null) : null)
    due.push({ itemId: r.it.id, number: r.it.number, type: r.it.type, paperTitle: r.paperTitle, snippet, dueAt: r.c.dueAt, intervalDays: r.c.intervalDays, lapses: r.c.lapses, streak: r.c.streak })
  }
  return { due, upcoming, total: rows.length }
}

export interface MyStats {
  byType: Array<{ type: string; items: number; attempts: number; correct: number; rate: number }>
  wrongCount: number
  reviewDue: number
  trainedItems: number
  today: DailyPlan
}

/** GET /api/me/stats:题型得分率(训练进度)、错题数(复习卡)、复习到期数、今日任务。 */
export async function myStats(db: Db, userId: string, now = new Date()): Promise<MyStats> {
  const rows = await db
    .select({ type: items.type, items: sql<number>`count(*)::int`, attempts: sql<number>`sum(${trainingProgress.attempts})::int`, correct: sql<number>`sum(${trainingProgress.correct})::int` })
    .from(trainingProgress)
    .innerJoin(items, eq(items.id, trainingProgress.itemId))
    .where(eq(trainingProgress.userId, userId))
    .groupBy(items.type)
  const [due] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewCards).where(and(eq(reviewCards.userId, userId), lte(reviewCards.dueAt, now)))
  // 错题本 = 复习卡(只有答错过的题才建卡)
  const [wrong] = await db.select({ n: sql<number>`count(*)::int` }).from(reviewCards).where(eq(reviewCards.userId, userId))
  return {
    byType: rows.map((r) => ({ type: r.type, items: r.items, attempts: r.attempts ?? 0, correct: r.correct ?? 0, rate: r.attempts ? Math.round((r.correct / r.attempts) * 1000) / 1000 : 0 })),
    wrongCount: wrong?.n ?? 0,
    reviewDue: due?.n ?? 0,
    trainedItems: rows.reduce((n, r) => n + r.items, 0),
    today: await dailyPlan(db, userId, now),
  }
}
