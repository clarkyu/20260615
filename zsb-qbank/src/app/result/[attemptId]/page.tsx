'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// 成绩页(SPEC §10 M3):总分 + 分大题得分 + 逐题对错;点小题看详情。
// 参考答案与解析仅当接口下发(练习 / 考试发布后)才展示——未发布的考试拿不到。

interface ResultItem {
  itemId: string
  number: number
  fullScore: number
  objective: boolean
  verdict: string
  score: number | null
  answer: unknown
  feedback: string | null
  accepted?: string[]
  explanation?: string | null
}
interface ResultPayload {
  attempt: { id: string; mode: string; status: string; submittedAt: string | null; autoSubmitted: boolean }
  paper: { id: string; title: string; totalScore: number }
  total: { score: number; fullScore: number; pending: number; empty: number }
  sections: { id: string; title: string; score: number; fullScore: number; pending: number; items: ResultItem[] }[]
}

const CHIP: Record<string, string> = {
  correct: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  wrong: 'border-red-400 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
  too_many_words: 'border-red-400 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
  pending: 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  graded: 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  empty: 'border-neutral-300 text-neutral-400 dark:border-neutral-700',
}
const VERDICT_LABEL: Record<string, string> = {
  correct: '答对了',
  wrong: '答错了',
  too_many_words: '超出词数',
  pending: '等 AI 评分',
  graded: '已评分',
  empty: '没作答',
  error: '题目数据异常',
}

function answerText(a: unknown): string | null {
  if (!a || typeof a !== 'object') return null
  const o = a as { type?: string; value?: string; chunkIndexes?: number[]; keys?: string[] }
  if (o.type === 'text') return o.value?.trim() ? o.value : null
  if (o.type === 'sequence') return o.chunkIndexes?.length ? `已排 ${o.chunkIndexes.length} 个词块` : null
  if (o.type === 'choice') return o.keys?.length ? o.keys.join('、') : null
  return null
}

export default function ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const [data, setData] = useState<ResultPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/attempts/${attemptId}/result`)
        if (!alive) return
        if (res.status === 401) return setError('请先登录')
        if (res.status === 409) return setError('这份还没交卷,交卷后再来看成绩')
        if (!res.ok) return setError('没有找到成绩,回首页看看')
        setData((await res.json()) as ResultPayload)
      } catch {
        if (alive) setError('加载失败,检查一下网络再试')
      }
    })()
    return () => {
      alive = false
    }
  }, [attemptId])

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-medium">{error}</p>
        <Link href="/" className="flex min-h-11 items-center rounded-xl bg-blue-600 px-5 font-medium text-white">
          回首页
        </Link>
      </main>
    )
  }
  if (!data) {
    return (
      <main className="flex flex-1 items-center justify-center text-neutral-400">
        <p>成绩加载中…</p>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div>
        <h1 className="text-lg font-bold">{data.paper.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {data.attempt.mode === 'exam' ? '模拟考试' : '练习'}成绩
          {data.attempt.autoSubmitted ? ' · 到时自动交卷' : ''}
        </p>
      </div>

      <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="text-3xl font-bold">
          {data.total.score}
          <span className="text-base font-normal text-neutral-500"> / {data.total.fullScore} 分</span>
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          {data.total.pending > 0 ? `还有 ${data.total.pending} 题等 AI 评分,总分会更新。` : '所有已判题目都算进来了。'}
          {data.total.empty > 0 ? ` 有 ${data.total.empty} 题没作答。` : ''}
        </p>
      </div>

      {data.sections.map((s) => (
        <div key={s.id} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{s.title}</p>
            <p className="text-sm text-neutral-500">
              {s.score} / {s.fullScore} 分{s.pending > 0 ? ` · ${s.pending} 题待评` : ''}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {s.items.map((it) => (
              <button
                key={it.itemId}
                type="button"
                onClick={() => setOpenItem(openItem === it.itemId ? null : it.itemId)}
                className={`min-h-11 min-w-11 rounded-xl border text-sm font-medium ${CHIP[it.verdict] ?? CHIP.empty}`}
              >
                {it.number}
              </button>
            ))}
          </div>
          {s.items
            .filter((it) => it.itemId === openItem)
            .map((it) => (
              <div key={it.itemId} className="mt-2 rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
                <p className="font-semibold">
                  第 {it.number} 题:{VERDICT_LABEL[it.verdict] ?? it.verdict}
                  <span className="ml-1 font-normal text-neutral-500">
                    {it.score === null ? '待评' : `${it.score} 分`} / {it.fullScore} 分
                  </span>
                </p>
                {answerText(it.answer) ? <p className="mt-1">我的答案:{answerText(it.answer)}</p> : null}
                {it.accepted && it.accepted.length > 0 ? (
                  <p className="mt-1">
                    参考答案:<span className="font-medium">{it.accepted.join(' / ')}</span>
                  </p>
                ) : null}
                {it.explanation ? <p className="mt-1 text-neutral-600 dark:text-neutral-300">解析:{it.explanation}</p> : null}
                {it.feedback ? <p className="mt-1 text-neutral-600 dark:text-neutral-300">评语:{it.feedback}</p> : null}
                {!it.accepted && data.attempt.mode === 'exam' ? (
                  <p className="mt-1 text-neutral-400">参考答案和解析等老师发布成绩后可见。</p>
                ) : null}
              </div>
            ))}
        </div>
      ))}

      <Link
        href="/"
        className="flex min-h-11 items-center justify-center rounded-xl border border-neutral-300 font-medium dark:border-neutral-700"
      >
        回首页
      </Link>
    </main>
  )
}
