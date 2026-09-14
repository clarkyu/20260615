import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { papers } from '@/lib/db/schema'
import { assemblePaper } from '@/lib/db/queries'
import { ITEM_TYPE_LABEL, itemPreview } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

// 教师看整卷(含参考答案与解析):按大题 / 题组 / 小题展开;顶部直达「发布任务」。
function answerText(type: string, answer: unknown): string {
  const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  if (typeof a.reference === 'string') return a.reference
  if (Array.isArray(a.correct)) return list(a.correct).join('、')
  if (Array.isArray(a.accepted)) return list(a.accepted).join(' / ')
  return type === 'writing' ? '(见评分要点)' : JSON.stringify(answer)
}

export default async function TeacherPaperPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTeacherPage()
  const { id } = await params
  const db = getDb()
  const paper = await assemblePaper(db, id)
  if (!paper) notFound()
  const meta = await db.query.papers.findFirst({ where: eq(papers.id, id), columns: { answerKeyNote: true, status: true } })
  const nItems = paper.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0)
  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{paper.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {paper.year} · {paper.region} · 满分 {paper.totalScore} 分 · {paper.durationMinutes} 分钟 · {nItems} 小题
          </p>
        </div>
        <Link href={`/teacher/assignments?paperId=${encodeURIComponent(paper.id)}`} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          发布任务
        </Link>
      </div>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">本页含参考答案与解析，仅教师可见；请勿投屏给学生。</p>
      {meta?.answerKeyNote ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{meta.answerKeyNote}</p> : null}
      {paper.sections.map((s) => (
        <section key={s.id} className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold">
            {s.code} {s.title}
            <span className="ml-2 text-sm font-normal text-neutral-500">每题 {s.scorePerItem} 分</span>
          </h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">{s.instructions}</p>
          {s.groups.map((g) => {
            const stim = (g.stimulus && typeof g.stimulus === 'object' ? g.stimulus : null) as { title?: string; body?: string } | null
            return (
              <div key={g.id} className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                {stim?.body ? (
                  <details className="mb-2">
                    <summary className="cursor-pointer text-sm text-blue-600">{stim.title ?? '材料'}（展开）</summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{stim.body}</p>
                  </details>
                ) : null}
                {g.frame ? <p className="mb-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">{g.frame}</p> : null}
                <table className="w-full text-sm">
                  <tbody>
                    {g.items.map((it) => (
                      <tr key={it.id} className="border-t border-neutral-100 align-top dark:border-neutral-800">
                        <td className="w-12 py-2 pr-2 font-mono">{it.number}</td>
                        <td className="w-16 py-2 pr-2 text-neutral-500">{ITEM_TYPE_LABEL[it.type] ?? it.type}</td>
                        <td className="py-2 pr-2">{itemPreview(it.type, it.content, it.contextSnippet)}</td>
                        <td className="w-1/3 py-2 pr-2 text-emerald-700 dark:text-emerald-300">{answerText(it.type, it.answer)}</td>
                        <td className="w-1/4 py-2 text-xs text-neutral-500">{it.explanation ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </section>
      ))}
    </main>
  )
}
