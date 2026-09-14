'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// 试卷发布开关(SPEC §8 题库管理 / D7):只有 published 的试卷学生才在「自由练习」里看得到、
// 才能自己开卷;任务作答不受此限(由教师发布任务把关)。归档用于下架旧卷。

const LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' }
const NEXT: Record<string, { to: string; text: string }> = {
  draft: { to: 'published', text: '发布' },
  published: { to: 'draft', text: '撤回为草稿' },
  archived: { to: 'published', text: '重新发布' },
}

export function PaperStatus({ paperId, status }: { paperId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [cur, setCur] = useState(status)
  const [err, setErr] = useState<string | null>(null)
  const next = NEXT[cur]
  const set = (to: string) => {
    setBusy(true)
    setErr(null)
    void (async () => {
      try {
        const res = await fetch(`/api/teacher/papers/${encodeURIComponent(paperId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: to }) })
        if (!res.ok) {
          setErr('操作失败')
          return
        }
        setCur(to)
        router.refresh()
      } catch {
        setErr('网络不太好，再试一次')
      } finally {
        setBusy(false)
      }
    })()
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs ${cur === 'published' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : cur === 'archived' ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'}`}>
        {LABEL[cur] ?? cur}
      </span>
      {next ? (
        <button type="button" disabled={busy} onClick={() => set(next.to)} className="rounded-lg border border-neutral-300 px-2 py-1 text-xs disabled:opacity-60 dark:border-neutral-700">
          {busy ? '处理中…' : next.text}
        </button>
      ) : null}
      {cur !== 'archived' ? (
        <button type="button" disabled={busy} onClick={() => set('archived')} className="rounded-lg border border-neutral-300 px-2 py-1 text-xs text-neutral-500 disabled:opacity-60 dark:border-neutral-700">
          归档
        </button>
      ) : null}
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </span>
  )
}
