'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// 发布成绩按钮:整个任务(POST /api/teacher/assignments/:id/release)或单份作答
// (POST /api/teacher/attempts/:id/release)。发布后学生可见参考答案 / 解析 / 分数。
export function ReleaseButton({ kind, id, label, small }: { kind: 'assignment' | 'attempt'; id: string; label: string; small?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (kind === 'assignment' && !window.confirm('发布后学生将看到参考答案、解析与分数，确定发布？')) return
          setBusy(true)
          setMsg(null)
          void (async () => {
            try {
              const url = kind === 'assignment' ? `/api/teacher/assignments/${id}/release` : `/api/teacher/attempts/${id}/release`
              const res = await fetch(url, { method: 'POST' })
              const j = (await res.json().catch(() => null)) as { released?: number; error?: { message?: string } } | null
              if (!res.ok) {
                setMsg(j?.error?.message ?? '发布失败')
                return
              }
              setMsg(`已发布 ${j?.released ?? 0} 份`)
              router.refresh()
            } catch {
              setMsg('网络不太好，再试一次')
            } finally {
              setBusy(false)
            }
          })()
        }}
        className={small ? 'rounded-lg border border-blue-600 px-2 py-1 text-xs text-blue-700 disabled:opacity-60 dark:text-blue-300' : 'rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60'}
      >
        {busy ? '发布中…' : label}
      </button>
      {msg ? <span className="text-xs text-neutral-500">{msg}</span> : null}
    </span>
  )
}
