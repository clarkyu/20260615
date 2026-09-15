import Link from 'next/link'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { acceptedCandidates } from '@/lib/db/item-bank'
import { AcceptedCandidates } from '@/components/teacher/AcceptedCandidates'

export const dynamic = 'force-dynamic'

// 答案候选(SPEC §8:「`accepted` 候选(来自 AI 兜底)在此采纳或拒绝」)。
export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ paperId?: string }> }) {
  await requireTeacherPage()
  const sp = await searchParams
  const rows = await acceptedCandidates(getDb(), { paperId: sp.paperId })

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">答案候选</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            汉译英填空的答案键穷举不完。学生写了个词表里没有、但 AI 判为可接受的说法，就会出现在这里。
            采纳后它进答案键，以后同样的答案<strong>按规则判分、不再送 AI</strong>（省钱，也不会两次判得不一样）；
            判为错答的以后不再出现在这里，并计入「常见错答」。
          </p>
        </div>
        <Link href="/teacher/bank" className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
          回题库
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
          暂时没有待处理的候选。学生做过汉译英填空、且 AI 兜底判了「可接受」之后，这里才会有东西。
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {rows.map((r) => (
            <section key={r.itemId} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  第 {r.number} 题
                  <span className="ml-2 text-sm font-normal text-neutral-500">{r.paperTitle}</span>
                </h2>
                <Link href={`/teacher/papers/${r.paperId}#item-${r.number}`} className="text-sm text-blue-600 hover:underline">
                  看整题
                </Link>
              </div>
              {r.zh ? <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{r.zh}</p> : null}
              <p className="mt-2 text-sm text-neutral-500">
                现有答案键：
                {r.accepted.map((a) => (
                  <span key={a} className="ml-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">
                    {a}
                  </span>
                ))}
              </p>
              <AcceptedCandidates itemId={r.itemId} candidates={r.candidates} />
            </section>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-neutral-500">
        采纳或拒绝都<strong>不会</strong>回头改学生已经拿到的分数（那条路走「批改」页，老师改分是终评）；
        它只影响以后的判分。
      </p>
    </main>
  )
}
