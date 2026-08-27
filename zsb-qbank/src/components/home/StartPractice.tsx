'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// 首页练习入口:POST /api/attempts 建 practice 作答,成功即进作答页。
export function StartPracticeButton({ paperId }: { paperId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setErr(null)
          void (async () => {
            try {
              const res = await fetch('/api/attempts', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ paperId, mode: 'practice' }),
              })
              if (res.status === 401) {
                setErr('请先登录')
                return
              }
              const json = (await res.json()) as { attemptId?: string }
              if (!res.ok || !json.attemptId) {
                setErr('开始失败,再点一次试试')
                return
              }
              router.push(`/play/${json.attemptId}`)
            } catch {
              setErr('网络不太好,再点一次试试')
            } finally {
              setBusy(false)
            }
          })()
        }}
        className="min-h-11 rounded-xl bg-blue-600 px-5 font-medium text-white disabled:opacity-60"
      >
        {busy ? '准备中…' : '开始练习'}
      </button>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
    </div>
  )
}

// 开发登录快捷按钮(仅 AUTH_DEV_LOGIN=true 的环境由服务端决定是否渲染)。
export function DevLoginButton({ role, label }: { role: 'student' | 'teacher'; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void (async () => {
          try {
            const res = await fetch('/api/auth/dev-login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ role }),
            })
            if (res.ok) router.refresh()
          } finally {
            setBusy(false)
          }
        })()
      }}
      className="min-h-11 rounded-xl border border-neutral-300 px-4 text-sm font-medium disabled:opacity-60 dark:border-neutral-700"
    >
      {label}
    </button>
  )
}
