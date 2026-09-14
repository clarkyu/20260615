import { eq, sql } from 'drizzle-orm'
import type { Db } from './client'
import { papers, sections, groups, items } from './schema'
import type { Paper } from '@/lib/schema/paper'

// 试卷落库(种子导入与教师导入向导共用):zod 校验由调用方完成(唯一事实来源);
// 事务内 upsert 试卷 + 整树重建子表(sections 由 paper 级联删除,groups/items 由 sections
// 级联)。重复执行不产生重复记录;同 id 再导即覆盖(勘误后重跑即生效)。

export interface UpsertPaperResult {
  paperId: string
  sections: number
  groups: number
  items: number
  scoreSum: number
}

export async function upsertPaper(db: Db, paper: Paper, opts: { createdBy?: string | null } = {}): Promise<UpsertPaperResult> {
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
