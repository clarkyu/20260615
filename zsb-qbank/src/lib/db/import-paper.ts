import { eq, sql } from 'drizzle-orm'
import type { Db } from './client'
import { papers, sections, groups, items, responses } from './schema'
import type { Paper } from '@/lib/schema/paper'

// 试卷落库(种子导入与教师导入向导共用):zod 校验由调用方完成(唯一事实来源);
// 事务内 upsert 试卷 + 整树重建子表(sections 由 paper 级联删除,groups/items 由 sections
// 级联)。重复执行不产生重复记录;同 id 再导即覆盖(勘误后重跑即生效)。
//
// **整树重建会连学生作答一起删掉。** `responses.item_id` 对 `items.id` 是 ON DELETE CASCADE,
// 所以删 sections → groups → items 一路级联到 responses(还有错题本、常见错答、判分缓存)。
// 这道门原本只写在 `PUT /api/teacher/papers/:id` 里(D24/D27),而 `pnpm seed` 直连本函数,
// 什么都继承不到 —— 在已有作答的库上跑一次种子,那份试卷的作答会被静默删光,
// 脚本还照常打印「导入完成」「断言通过」(2026-09-17 实测:5 行作答 → 0 行,attempt 还在)。
// 门就应该在真正删数据的这一层,而不是某一个调用方那里(D79)。

export interface UpsertPaperResult {
  paperId: string
  sections: number
  groups: number
  items: number
  scoreSum: number
}

/** 整卷重建会毁掉已有作答时抛它;调用方按自己的形态处理(接口回 409、脚本打印指引后退出)。 */
export class PaperHasResponsesError extends Error {
  constructor(readonly paperId: string, readonly responseCount: number) {
    super(`试卷 ${paperId} 已有 ${responseCount} 条学生作答,整卷重建会把它们一并删除`)
    this.name = 'PaperHasResponsesError'
  }
}

/** 这份试卷的小题上已经落了多少条学生作答。 */
export async function responseCountOf(db: Db, paperId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(responses)
    .innerJoin(items, eq(responses.itemId, items.id))
    .where(eq(items.paperId, paperId))
  return row?.n ?? 0
}

export async function upsertPaper(
  db: Db,
  paper: Paper,
  opts: { createdBy?: string | null; allowDestroyingResponses?: boolean } = {},
): Promise<UpsertPaperResult> {
  // 默认不许毁作答。要真重建(比如这份试卷的数据本身是废的),调用方得明说。
  if (!opts.allowDestroyingResponses) {
    const n = await responseCountOf(db, paper.id)
    if (n > 0) throw new PaperHasResponsesError(paper.id, n)
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(papers)
      .values({
        id: paper.id,
        title: paper.title,
        year: paper.year,
        region: paper.region,
        source: paper.source,
        totalScore: paper.totalScore,
        durationMinutes: paper.durationMinutes,
        status: paper.status,
        answerKeyNote: paper.answerKeyNote,
        createdBy: opts.createdBy ?? null,
      })
      .onConflictDoUpdate({
        target: papers.id,
        set: {
          title: paper.title,
          year: paper.year,
          region: paper.region,
          source: paper.source,
          totalScore: paper.totalScore,
          durationMinutes: paper.durationMinutes,
          status: paper.status,
          answerKeyNote: paper.answerKeyNote,
          updatedAt: sql`now()`,
        },
      })
    await tx.delete(sections).where(eq(sections.paperId, paper.id))
    for (const s of paper.sections) {
      const [sec] = await tx
        .insert(sections)
        .values({
          paperId: paper.id,
          order: s.order,
          code: s.code,
          title: s.title,
          instructions: s.instructions,
          itemType: s.itemType,
          scorePerItem: s.scorePerItem,
        })
        .returning({ id: sections.id })
      if (!sec) throw new Error('插入大题失败')
      for (const g of s.groups) {
        const [grp] = await tx
          .insert(groups)
          .values({ sectionId: sec.id, order: g.order, kind: g.kind, stimulus: g.stimulus ?? null, frame: g.frame ?? null })
          .returning({ id: groups.id })
        if (!grp) throw new Error('插入题组失败')
        if (g.items.length > 0) {
          await tx.insert(items).values(
            g.items.map((it) => ({
              groupId: grp.id,
              sectionId: sec.id,
              paperId: paper.id,
              number: it.number,
              type: it.type,
              score: it.score,
              content: it.content,
              answer: it.answer,
              explanation: it.explanation ?? null,
              knowledgeTags: it.knowledgeTags,
              difficulty: it.difficulty,
              contextSnippet: it.contextSnippet ?? null,
              origin: it.origin ?? 'official',
              status: it.status ?? 'approved',
            })),
          )
        }
      }
    }
  })
  return countPaper(db, paper.id)
}

export async function countPaper(db: Db, paperId: string): Promise<UpsertPaperResult> {
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0
  const nSections = await count(db.select({ n: sql<number>`count(*)::int` }).from(sections).where(eq(sections.paperId, paperId)))
  const nGroups = await count(
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(groups)
      .innerJoin(sections, eq(groups.sectionId, sections.id))
      .where(eq(sections.paperId, paperId)),
  )
  const nItems = await count(db.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.paperId, paperId)))
  const scoreSum = await count(db.select({ n: sql<number>`coalesce(sum(score), 0)::int` }).from(items).where(eq(items.paperId, paperId)))
  return { paperId, sections: nSections, groups: nGroups, items: nItems, scoreSum }
}
