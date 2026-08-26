import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { getSession } from '@/lib/auth/session'
import { papers, sections, groups, items } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

// 教师端只读整卷页(M1 验收):按 大题 → 题组 → 小题 展示,含答案与解析——
// 仅教师/管理员可见(学生端接口一律经 stripAnswers,本页是唯一例外的教师视图)。
export default async function TeacherPaperPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.user) redirect('/teacher/login')
  if (session.user.role !== 'teacher' && session.user.role !== 'admin') redirect('/')

  const { id } = await params
  const db = getDb()
  const paper = await db.query.papers.findFirst({ where: eq(papers.id, id) })
  if (!paper) notFound()
  const sectionRows = await db.select().from(sections).where(eq(sections.paperId, id)).orderBy(asc(sections.order))
  const groupRows = await db
    .select()
    .from(groups)
    .innerJoin(sections, eq(groups.sectionId, sections.id))
    .where(eq(sections.paperId, id))
    .orderBy(asc(sections.order), asc(groups.order))
  const itemRows = await db.select().from(items).where(eq(items.paperId, id)).orderBy(asc(items.number))

  const groupsBySection = new Map<string, (typeof groupRows)[number]['groups'][]>()
  for (const row of groupRows) {
    const list = groupsBySection.get(row.groups.sectionId) ?? []
    list.push(row.groups)
    groupsBySection.set(row.groups.sectionId, list)
  }
  const itemsByGroup = new Map<string, typeof itemRows>()
  for (const it of itemRows) {
    const list = itemsByGroup.get(it.groupId) ?? []
    list.push(it)
    itemsByGroup.set(it.groupId, list)
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">{paper.title}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {paper.year} 年 · {paper.region} · 满分 {paper.totalScore} · {paper.durationMinutes} 分钟 · 状态 {paper.status}
      </p>
      {paper.answerKeyNote ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{paper.answerKeyNote}</p> : null}

      {sectionRows.map((s) => (
        <section key={s.id} className="mt-8">
          <h2 className="text-lg font-bold">
            {s.title}
            <span className="ml-2 text-sm font-normal text-neutral-500">每题 {s.scorePerItem} 分 · {s.itemType}</span>
          </h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{s.instructions}</p>

          {(groupsBySection.get(s.id) ?? []).map((g) => (
            <div key={g.id} className="mt-4 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-xs font-medium text-neutral-400">题组 {g.order} · {g.kind}</p>
              {g.stimulus ? (
                <div className="mt-2 rounded-xl bg-neutral-50 p-3 text-sm whitespace-pre-wrap dark:bg-neutral-900">
                  {(g.stimulus as { title?: string; body: string }).title ? (
                    <p className="mb-1 font-semibold">{(g.stimulus as { title?: string }).title}</p>
                  ) : null}
                  {(g.stimulus as { body: string }).body}
                </div>
              ) : null}
              {g.frame ? <p className="mt-2 text-sm whitespace-pre-wrap">{g.frame}</p> : null}

              <ul className="mt-3 space-y-3">
                {(itemsByGroup.get(g.id) ?? []).map((it) => (
                  <li key={it.id} className="rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
                    <p className="font-medium">
                      {it.number}. <span className="text-neutral-400">[{it.type} · {it.score} 分 · 难度 {it.difficulty}]</span>
                    </p>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-neutral-700 dark:text-neutral-300">{JSON.stringify(it.content, null, 2)}</pre>
                    <p className="mt-2 font-medium text-emerald-700 dark:text-emerald-400">参考答案</p>
                    <pre className="whitespace-pre-wrap font-sans text-neutral-700 dark:text-neutral-300">{JSON.stringify(it.answer, null, 2)}</pre>
                    {it.explanation ? <p className="mt-2 text-neutral-600 dark:text-neutral-400">解析:{it.explanation}</p> : null}
                    {it.knowledgeTags.length > 0 ? (
                      <p className="mt-1 text-xs text-neutral-400">标签:{it.knowledgeTags.join('、')}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </main>
  )
}
