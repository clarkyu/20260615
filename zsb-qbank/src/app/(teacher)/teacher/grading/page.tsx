import Link from 'next/link'
import { requireTeacherPage } from '@/lib/auth/teacher'
import { getDb } from '@/lib/db/client'
import { gradingQueue, queueFacets, QUEUE_LIMIT_DEFAULT } from '@/lib/db/grading-queue'
import { orderBySimilarity } from '@/lib/grading/similarity'
import { GradeRow } from '@/components/teacher/GradeRow'
import { ITEM_TYPE_LABEL, itemPreview } from '@/lib/teacher/item-preview'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pick = (v: string | undefined) => (v && UUID.test(v) ? v : undefined)

function refText(type: string, answer: unknown): { reference: string; keyPoints: string[]; rubric: string } {
  const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  if (typeof a.reference === 'string') {
    const rubric = Array.isArray(a.rubric) ? (a.rubric as Array<{ name?: string; maxScore?: number; desc?: string }>).map((d) => `${d.name ?? ''} ${d.maxScore ?? ''} 分：${d.desc ?? ''}`).join('；') : typeof a.rubric === 'string' ? a.rubric : ''
    return { reference: a.reference, keyPoints: list(a.keyPoints), rubric }
  }
  if (Array.isArray(a.accepted)) return { reference: list(a.accepted).join(' / '), keyPoints: [], rubric: type === 'translate_c2e_fill' ? '词表未命中，AI 兜底判可接受与否' : '' }
  return { reference: '', keyPoints: [], rubric: '' }
}

// 批改队列(SPEC §8):筛选任务 / 小题 / 范围;同一小题批量浏览时按相似度排序;每行改分或确认。
export default async function TeacherGrading({ searchParams }: { searchParams: Promise<{ assignmentId?: string; itemId?: string; attemptId?: string; scope?: string }> }) {
  const { userId } = await requireTeacherPage()
  const sp = await searchParams
  const filter = {
    assignmentId: pick(sp.assignmentId),
    itemId: pick(sp.itemId),
    attemptId: pick(sp.attemptId),
    scope: sp.scope === 'subjective' ? ('subjective' as const) : ('needs_review' as const),
  }
  const db = getDb()
  let rows = await gradingQueue(db, userId, filter)
  if (filter.itemId) rows = orderBySimilarity(rows, (r) => r.answerText)
  const facets = await queueFacets(db, userId)
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { ...filter, ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return `/teacher/grading${s ? `?${s}` : ''}`
  }

  // 按小题分组展示(同题连续看)。
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const g = groups.get(r.item.id) ?? []
    g.push(r)
    groups.set(r.item.id, g)
  }

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">批改</h1>
        <div className="flex gap-2 text-sm">
          <Link href={qs({ scope: undefined })} className={`rounded-lg px-3 py-1.5 ${filter.scope === 'needs_review' ? 'bg-blue-600 text-white' : 'border border-neutral-300 dark:border-neutral-700'}`}>
            待复核
          </Link>
          <Link href={qs({ scope: 'subjective' })} className={`rounded-lg px-3 py-1.5 ${filter.scope === 'subjective' ? 'bg-blue-600 text-white' : 'border border-neutral-300 dark:border-neutral-700'}`}>
            抽查全部主观题
          </Link>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="text-neutral-500">按任务：</span>
        <Link href={qs({ assignmentId: undefined })} className={`rounded-full px-2 py-0.5 ${!filter.assignmentId ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}>
          全部
        </Link>
        {facets.assignments.map((a) => (
          <Link key={a.id} href={qs({ assignmentId: a.id })} className={`rounded-full px-2 py-0.5 ${filter.assignmentId === a.id ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}>
            {a.title}（{a.pending}）
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <span className="text-neutral-500">按小题：</span>
        <Link href={qs({ itemId: undefined })} className={`rounded-full px-2 py-0.5 ${!filter.itemId ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}>
          全部
        </Link>
        {facets.items.map((it) => (
          <Link key={it.id} href={qs({ itemId: it.id })} className={`rounded-full px-2 py-0.5 ${filter.itemId === it.id ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}>
            {it.number} {ITEM_TYPE_LABEL[it.type] ?? it.type}（{it.pending}）
          </Link>
        ))}
      </div>
      {filter.attemptId ? (
        <p className="mt-2 text-sm text-neutral-500">
          只看这一份作答。
          <Link href={qs({ attemptId: undefined })} className="ml-2 text-blue-600 hover:underline">
            清除
          </Link>
        </p>
      ) : null}
      {filter.itemId ? <p className="mt-2 text-xs text-neutral-400">已按学生答案相似度排序，相近的答案挨在一起。</p> : null}
      {rows.length >= QUEUE_LIMIT_DEFAULT ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">只显示前 {QUEUE_LIMIT_DEFAULT} 条，请用上面的任务 / 小题筛选缩小范围。</p> : null}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 text-center text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900">
          {filter.scope === 'needs_review' ? '没有待复核的作答。' : '没有主观题作答。'}
        </div>
      ) : (
        [...groups.entries()].map(([itemId, list]) => {
          const it = list[0]!.item
          const ref = refText(it.type, it.answer)
          return (
            <section key={itemId} className="mt-6">
              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30">
                <p className="font-medium">
                  第 {it.number} 题 · {ITEM_TYPE_LABEL[it.type] ?? it.type} · {it.score} 分
                  <Link href={qs({ itemId: it.id })} className="ml-3 text-blue-600 hover:underline">
                    只看这题
                  </Link>
                </p>
                <p className="mt-1 text-neutral-700 dark:text-neutral-300">{itemPreview(it.type, it.content, null)}</p>
                {ref.reference ? <p className="mt-1 text-emerald-700 dark:text-emerald-300">参考：{ref.reference}</p> : null}
                {ref.keyPoints.length ? <p className="text-neutral-600 dark:text-neutral-400">要点：{ref.keyPoints.join('；')}</p> : null}
                {ref.rubric ? <p className="text-neutral-500">细则：{ref.rubric}</p> : null}
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {list.map((r) => (
                  <GradeRow
                    key={r.responseId}
                    row={{
                      responseId: r.responseId,
                      studentName: r.studentName,
                      assignmentTitle: r.assignmentTitle,
                      attemptId: r.attemptId,
                      submittedAt: r.submittedAt?.toISOString() ?? null,
                      answerText: r.answerText,
                      fullScore: r.item.score,
                      score: r.score,
                      gradeSource: r.gradeSource,
                      needsReview: r.needsReview,
                      feedback: r.feedback,
                      ai: r.ai,
                      teacher: r.teacher,
                    }}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}
    </main>
  )
}
