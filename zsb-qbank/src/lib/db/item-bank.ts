import { and, arrayContains, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from './client'
import { aiGradeCache, items, papers, responses, sections, wrongAnswers } from './schema'
import { collectCandidates, mergeAccepted, type Candidate, type RawCandidate } from '@/lib/bank/candidates'
import { itemSchema, studentAnswerSchema } from '@/lib/schema/paper'
// 判分、常见错答统计、这里的比对共用同一套规范化。
import { normalizeText } from '@/lib/grading/normalize'

// 题库管理(SPEC §8):按试卷 / 大题 / 题型 / 知识点 / 年份筛选;accepted 候选采纳。
// 这里是唯一直接读写 items 的地方之一(另一处是导入与单题编辑接口)。

export interface BankFilter {
  paperId?: string
  year?: number
  type?: string
  tag?: string
  status?: 'draft' | 'approved'
  origin?: 'official' | 'teacher' | 'ai'
  /** 题号精确匹配(老师最常用「第几题」找) */
  number?: number
  limit?: number
  offset?: number
}

export interface BankItem {
  id: string
  number: number
  type: string
  score: number
  difficulty: number
  knowledgeTags: string[]
  status: string
  origin: string
  explanation: string | null
  content: unknown
  answer: unknown
  paperId: string
  paperTitle: string
  paperYear: number
  sectionTitle: string | null
}

const BANK_PAGE = 50

function conds(f: BankFilter) {
  const c = []
  if (f.paperId) c.push(eq(items.paperId, f.paperId))
  if (f.year !== undefined) c.push(eq(papers.year, f.year))
  if (f.type) c.push(eq(items.type, f.type))
  if (f.tag) c.push(arrayContains(items.knowledgeTags, [f.tag]))
  if (f.status) c.push(eq(items.status, f.status))
  if (f.origin) c.push(eq(items.origin, f.origin))
  if (f.number !== undefined) c.push(eq(items.number, f.number))
  return c
}

/** 筛选小题(含所属试卷与大题名),按试卷年份倒序、题号升序。 */
export async function listBankItems(db: Db, f: BankFilter): Promise<{ items: BankItem[]; total: number }> {
  const where = and(...conds(f))
  const limit = Math.min(Math.max(f.limit ?? BANK_PAGE, 1), 200)
  const rows = await db
    .select({
      id: items.id,
      number: items.number,
      type: items.type,
      score: items.score,
      difficulty: items.difficulty,
      knowledgeTags: items.knowledgeTags,
      status: items.status,
      origin: items.origin,
      explanation: items.explanation,
      content: items.content,
      answer: items.answer,
      paperId: items.paperId,
      paperTitle: papers.title,
      paperYear: papers.year,
      sectionTitle: sections.title,
    })
    .from(items)
    .innerJoin(papers, eq(papers.id, items.paperId))
    .leftJoin(sections, eq(sections.id, items.sectionId))
    .where(where)
    .orderBy(desc(papers.year), asc(papers.id), asc(items.number))
    .limit(limit)
    .offset(Math.max(f.offset ?? 0, 0))
  const totalRows = await db
    .select({ n: count() })
    .from(items)
    .innerJoin(papers, eq(papers.id, items.paperId))
    .where(where)
  return { items: rows as BankItem[], total: Number(totalRows[0]?.n ?? 0) }
}

export interface BankFacets {
  papers: { id: string; title: string; year: number; status: string; itemCount: number }[]
  types: { type: string; n: number }[]
  tags: { tag: string; n: number }[]
  drafts: number
}

/** 筛选器用的可选项与计数(不带筛选条件,老师一眼看到题库全貌)。 */
export async function bankFacets(db: Db): Promise<BankFacets> {
  const [paperRows, typeRows, tagRows, draftRows] = await Promise.all([
    db
      .select({ id: papers.id, title: papers.title, year: papers.year, status: papers.status, itemCount: count(items.id) })
      .from(papers)
      .leftJoin(items, eq(items.paperId, papers.id))
      .groupBy(papers.id, papers.title, papers.year, papers.status)
      .orderBy(desc(papers.year), asc(papers.id)),
    db.select({ type: items.type, n: count() }).from(items).groupBy(items.type).orderBy(desc(count())),
    db
      .select({ tag: sql<string>`unnest(${items.knowledgeTags})`.as('tag'), n: count().as('n') })
      .from(items)
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`))
      .limit(40),
    db.select({ n: count() }).from(items).where(eq(items.status, 'draft')),
  ])
  return {
    papers: paperRows.map((p) => ({ ...p, itemCount: Number(p.itemCount ?? 0) })),
    types: typeRows.map((t) => ({ type: t.type, n: Number(t.n ?? 0) })),
    tags: tagRows.map((t) => ({ tag: t.tag, n: Number(t.n ?? 0) })),
    drafts: Number(draftRows[0]?.n ?? 0),
  }
}

/** 能产生 accepted 候选的题型:只有汉译英填空走 AI 兜底(§5.2)。 */
export const CANDIDATE_TYPE = 'translate_c2e_fill'

export interface ItemCandidates {
  itemId: string
  number: number
  paperId: string
  paperTitle: string
  zh: string
  accepted: string[]
  candidates: Candidate[]
}

/**
 * 捞 accepted 候选:AI 兜底判了满分、但答案键里没有的学生答案。
 * 拒绝过的记在 wrong_answers(老师说不可接受 = 它就是个错答),据此排除。
 */
export async function acceptedCandidates(db: Db, f: { paperId?: string; itemId?: string } = {}): Promise<ItemCandidates[]> {
  const itemConds = [eq(items.type, CANDIDATE_TYPE)]
  if (f.paperId) itemConds.push(eq(items.paperId, f.paperId))
  if (f.itemId) itemConds.push(eq(items.id, f.itemId))
  const itemRows = await db
    .select({ id: items.id, number: items.number, score: items.score, content: items.content, answer: items.answer, paperId: items.paperId, paperTitle: papers.title })
    .from(items)
    .innerJoin(papers, eq(papers.id, items.paperId))
    .where(and(...itemConds))
    .orderBy(asc(items.paperId), asc(items.number))
  if (itemRows.length === 0) return []

  const ids = itemRows.map((i) => i.id)
  // AI 给了满分的作答 = AI 认为可接受。规则判对的不会走到 AI(gradeSource 是 auto)。
  const respRows = await db
    .select({ itemId: responses.itemId, answer: responses.answer, score: responses.score, updatedAt: responses.updatedAt })
    .from(responses)
    .where(and(inArray(responses.itemId, ids), eq(responses.gradeSource, 'ai')))
  const rejectRows = await db.select({ itemId: wrongAnswers.itemId, normalizedAnswer: wrongAnswers.normalizedAnswer }).from(wrongAnswers).where(inArray(wrongAnswers.itemId, ids))

  const rawByItem = new Map<string, RawCandidate[]>()
  const scoreById = new Map(itemRows.map((i) => [i.id, i.score]))
  for (const r of respRows) {
    if (r.score === null || r.score < (scoreById.get(r.itemId) ?? Infinity)) continue // 只要满分的
    const parsed = studentAnswerSchema.safeParse(r.answer)
    if (!parsed.success || parsed.data.type !== 'text') continue
    const list = rawByItem.get(r.itemId) ?? []
    list.push({ text: parsed.data.value, count: 1, lastSeenAt: r.updatedAt })
    rawByItem.set(r.itemId, list)
  }
  const rejectedByItem = new Map<string, string[]>()
  for (const r of rejectRows) {
    const list = rejectedByItem.get(r.itemId) ?? []
    list.push(r.normalizedAnswer)
    rejectedByItem.set(r.itemId, list)
  }

  const out: ItemCandidates[] = []
  for (const it of itemRows) {
    const accepted = ((it.answer as { accepted?: string[] }).accepted ?? []).slice()
    const candidates = collectCandidates(rawByItem.get(it.id) ?? [], { accepted, rejected: rejectedByItem.get(it.id) ?? [] })
    if (candidates.length === 0) continue
    out.push({
      itemId: it.id,
      number: it.number,
      paperId: it.paperId,
      paperTitle: it.paperTitle,
      zh: String((it.content as { zh?: string }).zh ?? ''),
      accepted,
      candidates,
    })
  }
  return out
}

export type AdoptResult =
  | { ok: true; accepted: string[]; added: string[]; duplicates: string[]; overflow: string[]; rejected: string[] }
  | { ok: false; error: string }

/**
 * 采纳 / 拒绝候选。
 * - 采纳:并进 answer.accepted,整题过一遍 itemSchema(硬约束 4),并清掉这题的 AI 评分缓存
 *   —— 缓存是按旧答案键算的,留着会让后来的学生命中旧判法。
 * - 拒绝:记进 wrong_answers,以后不再作为候选出现,也进「常见错答」。
 * 已经判过的作答不回溯改分(和单题编辑同一口径:改分走批改队列)。
 */
export async function resolveCandidates(db: Db, itemId: string, input: { adopt?: string[]; reject?: string[] }): Promise<AdoptResult> {
  const row = await db.query.items.findFirst({ where: eq(items.id, itemId) })
  if (!row) return { ok: false, error: '小题不存在' }
  if (row.type !== CANDIDATE_TYPE) return { ok: false, error: '这个题型没有 accepted 候选' }

  const existing = ((row.answer as { accepted?: string[] }).accepted ?? []).slice()
  const merged = mergeAccepted(existing, input.adopt ?? [])
  const rejects = (input.reject ?? []).map((s) => s.trim()).filter(Boolean)

  if (merged.added.length > 0) {
    const nextAnswer = { ...(row.answer as Record<string, unknown>), accepted: merged.accepted }
    const check = itemSchema.safeParse({
      number: row.number,
      type: row.type,
      score: row.score,
      explanation: row.explanation ?? undefined,
      knowledgeTags: row.knowledgeTags,
      difficulty: row.difficulty as 1 | 2 | 3,
      contextSnippet: row.contextSnippet ?? undefined,
      content: row.content,
      answer: nextAnswer,
      origin: row.origin,
      status: row.status,
    })
    if (!check.success) return { ok: false, error: '采纳后的小题未通过校验' }
  }

  await db.transaction(async (tx) => {
    if (merged.added.length > 0) {
      await tx
        .update(items)
        .set({ answer: { ...(row.answer as Record<string, unknown>), accepted: merged.accepted }, updatedAt: new Date() })
        .where(eq(items.id, itemId))
      // 答案键变了:按旧键算出来的 AI 评分缓存一律作废(与单题编辑同一处理)。
      await tx.delete(aiGradeCache).where(eq(aiGradeCache.itemId, itemId))
      // 采纳的答案不再是「错答」:从常见错答里清掉(之前 AI 判 0 分记过的情形)。
      const norms = merged.added.map((a) => normalizeText(a))
      if (norms.length > 0) {
        await tx.delete(wrongAnswers).where(and(eq(wrongAnswers.itemId, itemId), inArray(wrongAnswers.normalizedAnswer, norms)))
      }
    }
    for (const r of rejects) {
      await tx
        .insert(wrongAnswers)
        .values({ itemId, normalizedAnswer: normalizeText(r), count: 1 })
        .onConflictDoUpdate({ target: [wrongAnswers.itemId, wrongAnswers.normalizedAnswer], set: { lastSeenAt: new Date() } })
    }
  })

  return { ok: true, accepted: merged.accepted, added: merged.added, duplicates: merged.duplicates, overflow: merged.overflow, rejected: rejects }
}
