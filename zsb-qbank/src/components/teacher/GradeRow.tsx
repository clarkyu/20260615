'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// 批改队列一行:学生答案、AI 分与理由、参考答案 / 要点、改分或确认。
// PUT /api/teacher/responses/:id/grade;保存后本行变为「教师终评」。

export interface GradeRowData {
  responseId: string
  studentName: string
  assignmentTitle: string | null
  attemptId: string
  submittedAt: string | null
  answerText: string
  fullScore: number
  score: number | null
  gradeSource: string | null
  needsReview: boolean
  feedback: string | null
  ai: { score?: number; confidence?: number; keyPointsHit?: string[]; issues?: string[]; error?: string } | null
  teacher: { score: number; at: string; confirmed: boolean } | null
}

export function GradeRow({ row }: { row: GradeRowData }) {
  const router = useRouter()
  const [score, setScore] = useState<string>(row.score !== null ? String(row.score) : '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ score: number } | null>(row.gradeSource === 'teacher' && row.teacher ? { score: row.teacher.score } : null)

  const send = (body: Record<string, unknown>) => {
    setBusy(true)
    setMsg(null)
    void (async () => {
      try {
        const res = await fetch(`/api/teacher/responses/${row.responseId}/grade`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const j = (await res.json().catch(() => null)) as { score?: number; error?: { message?: string } } | null
        if (!res.ok || typeof j?.score !== 'number') {
          setMsg(j?.error?.message ?? '保存失败')
          return
        }
        setSaved({ score: j.score })
        setScore(String(j.score))
        router.refresh()
      } catch {
        setMsg('网络不太好，再试一次')
      } finally {
        setBusy(false)
      }
    })()
  }

  const conf = typeof row.ai?.confidence === 'number' ? Math.round(row.ai.confidence * 100) : null
  return (
    <div className={`rounded-2xl border p-4 ${saved ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-medium">{row.studentName}</span>
          {row.assignmentTitle ? <span className="ml-2 text-neutral-500">{row.assignmentTitle}</span> : <span className="ml-2 text-neutral-400">自由练习</span>}
        </span>
        <span className="text-neutral-500">
          {row.needsReview ? <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">待复核</span> : null}
          {saved ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">教师终评 {saved.score} 分</span> : null}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-800">{row.answerText || <span className="text-neutral-400">（空）</span>}</p>
      <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <p className="text-neutral-500">
            AI 评分：
            {row.ai?.error ? (
              <span className="text-red-600">未评（{row.ai.error}）</span>
            ) : typeof row.ai?.score === 'number' ? (
              <span>
                {row.ai.score} / {row.fullScore}
                {conf !== null ? <span className="text-neutral-400">（置信 {conf}%）</span> : null}
              </span>
            ) : (
              <span className="text-neutral-400">无</span>
            )}
          </p>
          {row.ai?.keyPointsHit?.length ? <p className="text-emerald-700 dark:text-emerald-300">命中：{row.ai.keyPointsHit.join('；')}</p> : null}
          {row.ai?.issues?.length ? <p className="text-red-600">问题：{row.ai.issues.join('；')}</p> : null}
          {row.feedback ? <p className="text-neutral-600 dark:text-neutral-300">评语：{row.feedback}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <label className="flex items-center gap-1">
            分数
            <input
              type="number"
              min={0}
              max={row.fullScore}
              step={0.5}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="w-20 rounded-lg border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <span className="text-neutral-400">/ {row.fullScore}</span>
          </label>
          <button type="button" disabled={busy || score === ''} onClick={() => send({ score: Number(score) })} className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-60">
            保存
          </button>
          {typeof row.ai?.score === 'number' && !saved ? (
            <button type="button" disabled={busy} onClick={() => send({ confirm: true })} className="rounded-lg border border-blue-600 px-3 py-1.5 text-blue-700 disabled:opacity-60 dark:text-blue-300">
              确认 AI 分
            </button>
          ) : null}
          {msg ? <span className="text-xs text-red-600">{msg}</span> : null}
        </div>
      </div>
    </div>
  )
}
