import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../src/lib/db/client'
import { papers, sections, groups, items } from '../src/lib/db/schema'
import { paperSchema } from '../src/lib/schema/paper'

// 幂等导入种子试卷(SPEC M1):zod 校验(唯一事实来源)→ 事务内 upsert 试卷 +
// 整树重建子表(sections/groups/items 级联删除后按种子重插)→ 断言结构计数。
// 重复执行不产生重复记录;种子字段被删改时 zod 报出准确错误。

async function main() {
  const file = process.argv[2] ?? join(import.meta.dirname, '..', 'seed', 'paper-2025-hubei-english.json')
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  const parsed = paperSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('种子文件未通过 schema 校验:')
    console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'))
    process.exit(1)
  }
  const paper = parsed.data

  const db = getDb()
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
    // 子表整树重建:sections 由 paper 级联,groups/items 由 sections 级联。
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

  // 断言:1 份试卷、6 个大题、8 个题组、43 个小题、总分 100(SPEC M1 验收)。
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0
  const nSections = await count(db.select({ n: sql<number>`count(*)::int` }).from(sections).where(eq(sections.paperId, paper.id)))
  const nGroups = await count(
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(groups)
      .innerJoin(sections, eq(groups.sectionId, sections.id))
      .where(eq(sections.paperId, paper.id)),
  )
  const nItems = await count(db.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.paperId, paper.id)))
  const scoreSum = await count(db.select({ n: sql<number>`coalesce(sum(score), 0)::int` }).from(items).where(eq(items.paperId, paper.id)))

  const expect = { sections: 6, groups: 8, items: 43, scoreSum: 100 }
  const got = { sections: nSections, groups: nGroups, items: nItems, scoreSum }
  console.log('导入完成:', JSON.stringify({ paper: paper.id, ...got }))
  if (paper.id === 'hubei-zsb-english-2025') {
    for (const [k, v] of Object.entries(expect)) {
      if (got[k as keyof typeof got] !== v) {
        console.error(`断言失败:${k} 期望 ${v},实际 ${got[k as keyof typeof got]}`)
        process.exit(1)
      }
    }
    console.log('断言通过:1 份试卷、6 个大题、8 个题组、43 个小题、总分 100。')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
