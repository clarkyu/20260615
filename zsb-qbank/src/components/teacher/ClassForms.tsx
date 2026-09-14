'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// 建班表单:POST /api/teacher/classes { name } → 刷新列表(服务端渲染加入码)。
export function CreateClassForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        setBusy(true)
        setErr(null)
        void (async () => {
          try {
            const res = await fetch('/api/teacher/classes', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name: name.trim() }),
            })
            if (!res.ok) {
              const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
              setErr(j?.error?.message ?? '创建失败，再试一次')
              return
            }
            setName('')
            router.refresh()
          } catch {
            setErr('网络不太好，再试一次')
          } finally {
            setBusy(false)
          }
        })()
      }}
    >
      <label className="flex flex-col text-sm">
        <span className="text-neutral-500">班级名称</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="例：2026 级英语 1 班"
          className="mt-1 w-64 rounded-xl border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      <button type="submit" disabled={busy || !name.trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {busy ? '创建中…' : '新建班级'}
      </button>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
    </form>
  )
}
