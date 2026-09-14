'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtTimeShort } from '@/lib/teacher/item-preview'

// 学生首页(SPEC §9.4 / M5):加入码入班 + 「我的任务」开始 / 继续 / 看成绩。
// 文案短、口语、全角标点;可点区域 ≥ 44px(硬约束 5、8)。

export function JoinClassForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const c = code.trim().toUpperCase()
        if (c.length !== 6) return setMsg({ ok: false, text: '加入码是 6 位' })
        setBusy(true)
        setMsg(null)
        void (async () => {
          try {
            const res = await fetch('/api/classes/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) })
            const j = (await res.json().catch(() => null)) as { class?: { name: string }; error?: { message?: string } } | null
            if (!res.ok || !j?.class) {
              setMsg({ ok: false, text: j?.error?.message ?? '没找到这个班，检查一下加入码' })
              return
            }
            setMsg({ ok: true, text: `已加入「${j.class.name}」` })
            setCode('')
            router.refresh()
          } catch {
            setMsg({ ok: false, text: '网络不太好，再试一次' })
          } finally {
            setBusy(false)
          }
        })()
      }}
    >
      <label className="flex flex-1 flex-col text-sm">
        <span className="text-neutral-500">老师给的加入码</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          maxLength={6}
          placeholder="6 位字母数字"
          className="mt-1 min-h-11 rounded-xl border border-neutral-300 px-3 font-mono text-base tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      <button type="submit" disabled={busy || code.trim().length !== 6} className="min-h-11 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-60">
        {busy ? '加入中…' : '加入班级'}
      </button>
      {msg ? <p className={`basis-full text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p> : null}
    </form>
  )
}

export interface AssignmentCard {
  id: string
  title: string
  mode: string
  className: string
  dueAt: string | null
  opensAt: string | null
  durationMinutes: number | null
  open: boolean
  openReason: 'not_yet' | 'closed' | null
  itemCount: number | null
  allowRetake: boolean
  attempt: { id: string; status: string; totalScore: number | null } | null
}

// 时间统一按北京时间显示(服务端与客户端输出一致,不会水合不匹配)。
const fmt = (d: string | null) => fmtTimeShort(d)

export function AssignmentItem({ a }: { a: AssignmentCard }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const done = a.attempt && a.attempt.status !== 'in_progress'
  const modeLabel = a.mode === 'exam' ? '考试' : '练习'
  const start = () => {
    setBusy(true)
    setErr(null)
    void (async () => {
      try {
        const res = await fetch('/api/attempts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assignmentId: a.id }) })
        const j = (await res.json().catch(() => null)) as { attemptId?: string; error?: { message?: string } } | null
        if (!res.ok || !j?.attemptId) {
          setErr(j?.error?.message ?? '开始失败，再点一次试试')
          return
        }
        router.push(`/play/${j.attemptId}`)
      } catch {
        setErr('网络不太好，再点一次试试')
      } finally {
        setBusy(false)
      }
    })()
  }
  return (
    <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{a.title}</p>
          <p className="mt-1 text-sm text-neutral-500">
            {a.className} · {modeLabel}
            {a.itemCount ? ` · ${a.itemCount} 题` : ''}
            {a.mode === 'exam' && a.durationMinutes ? ` · ${a.durationMinutes} 分钟` : ''}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            {a.openReason === 'not_yet' ? `${fmt(a.opensAt)} 开始` : a.dueAt ? `${fmt(a.dueAt)} 截止` : '不限时间'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${done ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : a.attempt ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800'}`}>
          {done ? (a.attempt?.status === 'released' ? '已出分' : '已交卷') : a.attempt ? '作答中' : '未开始'}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {done ? (
          <>
            <Link href={`/result/${a.attempt!.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-blue-600 px-4 font-medium text-blue-700 dark:text-blue-300">
              {a.attempt?.status === 'released' ? `看成绩${typeof a.attempt.totalScore === 'number' ? `（${a.attempt.totalScore} 分）` : ''}` : '看作答'}
            </Link>
            {a.open && a.allowRetake ? (
              <button type="button" disabled={busy} onClick={start} className="min-h-11 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-60">
                {busy ? '准备中…' : a.mode === 'exam' ? '再考一次' : '再练一次'}
              </button>
            ) : null}
          </>
        ) : a.open ? (
          <button type="button" disabled={busy} onClick={start} className="min-h-11 rounded-xl bg-blue-600 px-4 font-medium text-white disabled:opacity-60">
            {busy ? '准备中…' : a.attempt ? '继续作答' : a.mode === 'exam' ? '开始考试' : '开始练习'}
          </button>
        ) : (
          <span className="text-sm text-neutral-400">{a.openReason === 'not_yet' ? '还没开始' : '已截止'}</span>
        )}
      </div>
      {err ? <p className="mt-2 text-right text-sm text-red-600">{err}</p> : null}
    </div>
  )
}
