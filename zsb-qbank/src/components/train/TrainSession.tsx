'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FeedbackCard } from '@/components/play/FeedbackCard'
import { TrainItem, type TrainItemData } from './TrainItem'
import type { StudentAnswer } from '@/lib/schema/paper'

// 训练会话(SPEC §6):系统逐题推送 → 每题即判 → 反馈卡 → 下一题;一组做完再抓下一组,没题了结束。
// 汉译英未命中词表时服务端交 AI 兜底,这里轮询 /api/attempts/:id/feedback 等结果(§7.5,最长 30 秒)。

type Mode = 'daily' | 'review' | 'targeted'
interface Feedback {
  itemId: string
  verdict: string
  score: number
  fullScore: number
  accepted: string[]
  explanation: string | null
  commonMistakes: string[]
  pending?: { attemptId: string; jobId: string }
  review: { dueAt: string; intervalDays: number } | null
  scaffold: { level: number; l3Streak: number; off: boolean; hint: { level: number; off: boolean } | null }
}

const MODE_LABEL: Record<Mode, string> = { daily: '今日任务', review: '复习错题', targeted: '专项训练' }

export function TrainSession({ mode, type, tags }: { mode: Mode; type?: string; tags?: string[] }) {
  const [queue, setQueue] = useState<TrainItemData[]>([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [fb, setFb] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ total: number; correct: number }>({ total: 0, correct: 0 })
  const [finished, setFinished] = useState(false)
  const seen = useRef<string[]>([])
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchBatch = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const p = new URLSearchParams({ mode, count: '10' })
      if (type) p.set('type', type)
      if (tags?.length) p.set('tags', tags.join(','))
      if (seen.current.length) p.set('exclude', seen.current.slice(-200).join(','))
      const res = await fetch(`/api/training/next?${p.toString()}`)
      if (res.status === 401) return setErr('请先登录')
      if (!res.ok) return setErr('抓题失败，回训练页再试')
      const j = (await res.json()) as { items: TrainItemData[] }
      if (j.items.length === 0) {
        setFinished(true)
        return
      }
      setQueue(j.items)
      setIdx(0)
      setFb(null)
    } catch {
      setErr('网络不太好，再试一次')
    } finally {
      setLoading(false)
    }
  }, [mode, type, tags])

  useEffect(() => {
    void fetchBatch()
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [fetchBatch])

  const current = queue[idx]

  const submit = (answer: StudentAnswer) => {
    if (!current || busy) return
    setBusy(true)
    void (async () => {
      try {
        const res = await fetch('/api/training/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: current.itemId, answer }) })
        const j = (await res.json().catch(() => null)) as Feedback | { error?: { message?: string } } | null
        if (!res.ok || !j || !('verdict' in j)) {
          setErr((j as { error?: { message?: string } } | null)?.error?.message ?? '提交失败，再试一次')
          return
        }
        seen.current.push(current.itemId)
        setFb(j)
        setDone((d) => ({ total: d.total + 1, correct: d.correct + (j.verdict === 'correct' ? 1 : 0) }))
        if (j.pending) poll(j.pending.attemptId, current.itemId, Date.now())
      } catch {
        setErr('网络不太好，再试一次')
      } finally {
        setBusy(false)
      }
    })()
  }

  // 汉译英 AI 兜底:每 3 秒问一次结果,最长 30 秒。
  const poll = (attemptId: string, itemId: string, started: number) => {
    pollTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/attempts/${attemptId}/feedback?itemIds=${itemId}`)
          const j = (await res.json()) as { results?: Array<{ itemId: string; done: boolean; verdict: string; score: number | null; accepted?: string[]; explanation?: string | null; feedback?: string | null }> }
          const r = j.results?.[0]
          if (r?.done) {
            setFb((prev) => (prev && prev.itemId === itemId ? { ...prev, verdict: r.verdict, score: r.score ?? 0, accepted: r.accepted ?? [], explanation: r.explanation ?? null, pending: undefined } : prev))
            if (r.verdict === 'correct') setDone((d) => ({ ...d, correct: d.correct + 1 }))
            return
          }
        } catch {
          /* 下一轮再试 */
        }
        if (Date.now() - started < 30_000) poll(attemptId, itemId, started)
        else setFb((prev) => (prev && prev.itemId === itemId ? { ...prev, verdict: 'pending_timeout', pending: undefined } : prev))
      })()
    }, 3000)
  }

  const next = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
    setFb(null)
    if (idx + 1 < queue.length) setIdx(idx + 1)
    else void fetchBatch()
  }

  if (finished) {
    return (
      <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="text-lg font-bold">{done.total === 0 ? '暂时没有可练的题' : '这一轮做完了'}</p>
        {done.total > 0 ? (
          <p className="mt-1 text-neutral-600 dark:text-neutral-300">
            做了 {done.total} 题，对 {done.correct} 题。答错的题明天会出现在「复习错题」里。
          </p>
        ) : (
          <p className="mt-1 text-neutral-500">{mode === 'review' ? '今天没有到期的错题，先去做专项训练吧。' : '换个题型或知识点试试。'}</p>
        )}
        <div className="mt-3 flex gap-2">
          <Link href="/train" className="inline-flex min-h-11 items-center rounded-xl border border-neutral-300 px-4 dark:border-neutral-700">
            回训练页
          </Link>
          {done.total > 0 ? (
            <button type="button" onClick={() => { setFinished(false); setDone({ total: 0, correct: 0 }); void fetchBatch() }} className="min-h-11 rounded-xl bg-blue-600 px-4 font-medium text-white">
              再来一组
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <Link href="/train" className="min-h-11 inline-flex items-center text-blue-600">
          ← {MODE_LABEL[mode]}
        </Link>
        <span className="text-neutral-500">
          第 {done.total + 1} 题 · 对 {done.correct} / {done.total}
        </span>
      </div>
      {err ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p> : null}
      {loading || !current ? (
        <p className="p-4 text-center text-neutral-400">抓题中…</p>
      ) : (
        <>
          <TrainItem key={current.itemId} item={current} disabled={busy || !!fb} onSubmit={submit} />
          {fb ? (
            <>
              <FeedbackCard verdict={fb.verdict} score={fb.score} fullScore={fb.fullScore} accepted={fb.accepted} explanation={fb.explanation} commonMistakes={fb.commonMistakes} />
              <p className="text-xs text-neutral-500">
                {fb.review ? `这题 ${fb.review.intervalDays} 天后再复习一次。` : fb.verdict === 'correct' ? '答对了，不进错题本。' : ''}
                {fb.scaffold && current.scaffold
                  ? fb.scaffold.off
                    ? ' 脚手架已关闭，以后都自由拼写。'
                    : ` 下次这题用${(fb.scaffold.hint?.level ?? fb.scaffold.level) === 1 ? '一级（选词块）' : (fb.scaffold.hint?.level ?? fb.scaffold.level) === 2 ? '二级（首字母）' : '三级（自由拼写）'}。`
                  : ''}
              </p>
              <button type="button" onClick={next} className="min-h-12 rounded-xl bg-blue-600 font-medium text-white">
                {fb.pending ? '不等了，下一题' : '下一题'}
              </button>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
