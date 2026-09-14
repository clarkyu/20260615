'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// 教师端小题工具(M6):生成干扰项(采纳后写入 content.distractors,训练一级脚手架用)、生成变式题
// (以草稿入库,审核通过才会被训练抽到);草稿行的通过 / 删除。走 /api/teacher/items/generate + jobs/:id 轮询。

type JobResult = { distractors?: string[]; created?: Array<{ id: string; number: number }>; rejected?: string[] }

async function pollJob(jobId: string, timeoutMs = 120_000): Promise<{ status: string; result?: JobResult; error?: string }> {
  const started = Date.now()
  for (;;) {
    const res = await fetch(`/api/teacher/jobs/${jobId}`)
    const j = (await res.json()) as { job?: { status: string; result?: JobResult; error?: string } }
    if (j.job?.status === 'done' || j.job?.status === 'failed') return j.job
    if (Date.now() - started > timeoutMs) return { status: 'failed', error: '超时' }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

export function ItemTools({ itemId, type, distractors }: { itemId: string; type: string; distractors: string[] | undefined }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'distractors' | 'variants' | 'adopt' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [proposed, setProposed] = useState<string[] | null>(null)
  const scaffoldable = type === 'fill' || type === 'translate_c2e_fill'
  const variantable = scaffoldable || type === 'reorder'
  if (!variantable) return null

  const run = (mode: 'distractors' | 'variants') => {
    setBusy(mode)
    setMsg(null)
    void (async () => {
      try {
        const res = await fetch('/api/teacher/items/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId, mode, count: 3 }) })
        const j = (await res.json().catch(() => null)) as { jobId?: string; error?: { message?: string } } | null
        if (!res.ok || !j?.jobId) {
          setMsg(j?.error?.message ?? '发起失败')
          return
        }
        const job = await pollJob(j.jobId)
        if (job.status !== 'done') {
          setMsg(`失败：${job.error === 'ai_not_configured' ? 'AI 未配置' : (job.error ?? '未知错误')}`)
          return
        }
        if (mode === 'distractors') setProposed(job.result?.distractors ?? [])
        else {
          setMsg(`已生成 ${job.result?.created?.length ?? 0} 道草稿${job.result?.rejected?.length ? `（${job.result.rejected.length} 道不合格已丢弃）` : ''}，在下方「待审核变式」里审核`)
          router.refresh()
        }
      } catch {
        setMsg('网络不太好，再试一次')
      } finally {
        setBusy(null)
      }
    })()
  }
  const adopt = () => {
    if (!proposed) return
    setBusy('adopt')
    void (async () => {
      try {
        const res = await fetch(`/api/teacher/items/${itemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: { distractors: proposed } }) })
        if (!res.ok) {
          setMsg('保存失败')
          return
        }
        setProposed(null)
        setMsg('干扰项已采纳')
        router.refresh()
      } finally {
        setBusy(null)
      }
    })()
  }
  return (
    <div className="mt-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {scaffoldable ? (
          <button type="button" disabled={!!busy} onClick={() => run('distractors')} className="rounded-lg border border-neutral-300 px-2 py-1 disabled:opacity-60 dark:border-neutral-700">
            {busy === 'distractors' ? '生成中…' : distractors?.length ? `干扰项（${distractors.length}）重生成` : '生成干扰项'}
          </button>
        ) : null}
        <button type="button" disabled={!!busy} onClick={() => run('variants')} className="rounded-lg border border-neutral-300 px-2 py-1 disabled:opacity-60 dark:border-neutral-700">
          {busy === 'variants' ? '生成中…' : '生成 3 道变式'}
        </button>
        {msg ? <span className="text-neutral-500">{msg}</span> : null}
      </div>
      {scaffoldable && distractors?.length && !proposed ? <p className="mt-1 text-neutral-500">当前干扰项：{distractors.join(' / ')}</p> : null}
      {proposed ? (
        <p className="mt-1">
          AI 建议：<span className="font-medium">{proposed.join(' / ')}</span>
          <button type="button" disabled={busy === 'adopt'} onClick={adopt} className="ml-2 rounded-lg bg-blue-600 px-2 py-1 text-white disabled:opacity-60">
            采纳
          </button>
          <button type="button" onClick={() => setProposed(null)} className="ml-1 rounded-lg border border-neutral-300 px-2 py-1 dark:border-neutral-700">
            放弃
          </button>
        </p>
      ) : null}
    </div>
  )
}

export function DraftItemActions({ itemId }: { itemId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const act = (approve: boolean) => {
    setBusy(true)
    setMsg(null)
    void (async () => {
      try {
        const res = approve
          ? await fetch(`/api/teacher/items/${itemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) })
          : await fetch(`/api/teacher/items/${itemId}`, { method: 'DELETE' })
        if (!res.ok) {
          setMsg(approve ? '通过失败' : '删除失败')
          return
        }
        router.refresh()
      } finally {
        setBusy(false)
      }
    })()
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <button type="button" disabled={busy} onClick={() => act(true)} className="rounded-lg bg-emerald-600 px-2 py-1 text-white disabled:opacity-60">
        通过
      </button>
      <button type="button" disabled={busy} onClick={() => act(false)} className="rounded-lg border border-red-300 px-2 py-1 text-red-700 disabled:opacity-60 dark:text-red-300">
        删除
      </button>
      {msg ? <span className="text-red-600">{msg}</span> : null}
    </span>
  )
}
