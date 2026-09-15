'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// accepted 候选采纳(SPEC §8)。老师勾几条 → 采纳写进答案键 / 拒绝记为错答。
// 采纳之后同样的答案按规则判分,不再送 AI —— 这就是这个页面的意义。

export interface CandidateRow {
  text: string
  normalized: string
  count: number
  lastSeenAt: string | null
}

export function AcceptedCandidates({ itemId, candidates }: { itemId: string; candidates: CandidateRow[] }) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'adopt' | 'reject' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const toggle = (t: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const send = (action: 'adopt' | 'reject') => {
    if (picked.size === 0) {
      setMsg('先勾几条')
      return
    }
    setBusy(action)
    setMsg(null)
    void (async () => {
      try {
        const body = action === 'adopt' ? { itemId, adopt: [...picked] } : { itemId, reject: [...picked] }
        const res = await fetch('/api/teacher/items/candidates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const j = (await res.json().catch(() => null)) as { added?: string[]; duplicates?: string[]; overflow?: string[]; rejected?: string[]; error?: { message?: string } } | null
        if (!res.ok) {
          setMsg(j?.error?.message ?? '没成功，再试一次')
          return
        }
        if (action === 'adopt') {
          const parts = [`已采纳 ${j?.added?.length ?? 0} 条`]
          if (j?.duplicates?.length) parts.push(`${j.duplicates.length} 条答案键里已有`)
          if (j?.overflow?.length) parts.push(`${j.overflow.length} 条超出上限没加`)
          setMsg(parts.join('，') + '。以后同样的答案按规则判分，不再问 AI。')
        } else {
          setMsg(`已记为错答 ${j?.rejected?.length ?? 0} 条，以后不再作为候选出现。`)
        }
        setPicked(new Set())
        router.refresh()
      } catch {
        setMsg('网络不太好，再试一次')
      } finally {
        setBusy(null)
      }
    })()
  }

  return (
    <div className="mt-2">
      <ul className="flex flex-col gap-1">
        {candidates.map((c) => (
          <li key={c.normalized}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <input type="checkbox" checked={picked.has(c.text)} onChange={() => toggle(c.text)} className="size-4" />
              <span className="font-mono">{c.text}</span>
              <span className="text-xs text-neutral-500">{c.count} 人这么写</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => send('adopt')}
          className="min-h-9 rounded-xl bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === 'adopt' ? '采纳中…' : '采纳为正确答案'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => send('reject')}
          className="min-h-9 rounded-xl border border-neutral-300 px-3 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {busy === 'reject' ? '处理中…' : '判为错答'}
        </button>
        {msg ? <span className="text-sm text-neutral-600 dark:text-neutral-300">{msg}</span> : null}
      </div>
    </div>
  )
}
