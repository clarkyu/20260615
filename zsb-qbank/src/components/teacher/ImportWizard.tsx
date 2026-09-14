'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { DraftEditor, type Issue } from './DraftEditor'

// 导入向导(SPEC §8):上传 docx → 后台解析(规则切分 + AI 结构化)→ 校对页(左原文 / 右表单,问题标红)
// → 保存为试卷(PUT /api/teacher/papers/:id,zod 校验失败按路径回显)。

type Json = Record<string, unknown>
type Stage = 'upload' | 'parsing' | 'review' | 'saved'

interface JobResult {
  draft: Json
  issues: Issue[]
  valid: boolean
  answerKey: string | null
  markdown: string
  aiUsed: boolean
  aiCalls: number
}

export function ImportWizard() {
  const [stage, setStage] = useState<Stage>('upload')
  const [err, setErr] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [draft, setDraft] = useState<Json | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [answerKey, setAnswerKey] = useState<string | null>(null)
  const [aiInfo, setAiInfo] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  // 轮询解析任务(每 2 秒,最长 5 分钟)。
  useEffect(() => {
    if (stage !== 'parsing' || !jobId) return
    let alive = true
    const started = Date.now()
    const tick = async () => {
      try {
        const res = await fetch(`/api/teacher/jobs/${jobId}`)
        const j = (await res.json()) as { job?: { status: string; result?: JobResult; error?: string } }
        if (!alive) return
        setElapsed(Math.round((Date.now() - started) / 1000))
        if (j.job?.status === 'done' && j.job.result) {
          setDraft(j.job.result.draft)
          setIssues(j.job.result.issues)
          setAnswerKey(j.job.result.answerKey)
          setAiInfo(j.job.result.aiUsed ? `AI 已补全答案与解析（${j.job.result.aiCalls} 次调用），请逐题核对。` : 'AI 未配置：答案与解析需手动填写。')
          setStage('review')
          return
        }
        if (j.job?.status === 'failed') {
          setErr(`解析失败：${j.job.error ?? '未知错误'}`)
          setStage('upload')
          return
        }
        if (Date.now() - started > 5 * 60_000) {
          setErr('解析超时，请重试')
          setStage('upload')
          return
        }
        setTimeout(tick, 2000)
      } catch {
        if (alive) setTimeout(tick, 3000)
      }
    }
    void tick()
    return () => {
      alive = false
    }
  }, [stage, jobId])

  const upload = () => {
    const f = fileRef.current?.files?.[0]
    if (!f) return setErr('请选择 .docx 文件')
    setErr(null)
    const fd = new FormData()
    fd.append('file', f)
    setStage('parsing')
    setElapsed(0)
    void (async () => {
      try {
        const res = await fetch('/api/teacher/papers/import', { method: 'POST', body: fd })
        const j = (await res.json().catch(() => null)) as { jobId?: string; markdown?: string; error?: { message?: string } } | null
        if (!res.ok || !j?.jobId) {
          setErr(j?.error?.message ?? '上传失败')
          setStage('upload')
          return
        }
        setMarkdown(j.markdown ?? '')
        setJobId(j.jobId)
      } catch {
        setErr('网络不太好，再试一次')
        setStage('upload')
      }
    })()
  }

  const save = () => {
    if (!draft) return
    setSaving(true)
    setErr(null)
    void (async () => {
      try {
        const id = String(draft.id ?? '')
        const res = await fetch(`/api/teacher/papers/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
        const j = (await res.json().catch(() => null)) as { ok?: boolean; issues?: Issue[]; error?: { message?: string } } | null
        if (!res.ok) {
          if (j?.issues) setIssues(j.issues)
          setErr(j?.error?.message ?? '保存失败')
          return
        }
        setSavedId(id)
        setStage('saved')
      } catch {
        setErr('网络不太好，再试一次')
      } finally {
        setSaving(false)
      }
    })()
  }

  if (stage === 'saved' && savedId) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950/30">
        <p className="text-lg font-medium">试卷已保存：{savedId}</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">状态为{String(draft?.status) === 'published' ? '「已发布」' : '「草稿」'}；可以在试卷页查看整卷，或直接发布任务给班级。</p>
        <div className="mt-4 flex gap-3 text-sm">
          <Link href={`/teacher/papers/${encodeURIComponent(savedId)}`} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white">
            查看整卷
          </Link>
          <Link href={`/teacher/assignments?paperId=${encodeURIComponent(savedId)}`} className="rounded-xl border border-blue-600 px-4 py-2 font-medium text-blue-700 dark:text-blue-300">
            发布任务
          </Link>
          <button type="button" className="rounded-xl border border-neutral-300 px-4 py-2 dark:border-neutral-700" onClick={() => setStage('review')}>
            继续编辑
          </button>
        </div>
      </div>
    )
  }

  if (stage === 'review' && draft) {
    const schemaIssues = issues.filter((i) => i.source === 'schema').length
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {aiInfo} 待确认 {issues.length} 处{schemaIssues ? `，其中 ${schemaIssues} 处必须修正才能保存` : ''}。
          </p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={saving} onClick={save} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {saving ? '保存中…' : '保存试卷'}
            </button>
            <button type="button" className="rounded-xl border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" onClick={() => setStage('upload')}>
              重新上传
            </button>
          </div>
        </div>
        {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-[2fr_3fr]">
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-auto">
            <details open className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <summary className="cursor-pointer text-sm font-medium">原文（Word 转 Markdown）</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-5 text-neutral-700 dark:text-neutral-300">{markdown}</pre>
            </details>
            {answerKey ? (
              <details className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <summary className="cursor-pointer text-sm font-medium">文档附带的参考答案</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-5">{answerKey}</pre>
              </details>
            ) : null}
          </div>
          <DraftEditor draft={draft} issues={issues} onChange={setDraft} />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="font-medium">上传 Word 真题（.docx）</p>
      <p className="mt-1 text-sm text-neutral-500">服务端转成 Markdown，规则引擎切分大题 / 题组 / 小题，AI 补参考答案与解析；拿不准的地方会标红，你逐题确认后保存。文档末尾若附参考答案会自动采用。</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".docx" className="text-sm" disabled={stage === 'parsing'} />
        <button type="button" disabled={stage === 'parsing'} onClick={upload} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {stage === 'parsing' ? `解析中… ${elapsed}s` : '上传并解析'}
        </button>
      </div>
      {stage === 'parsing' ? <p className="mt-3 text-sm text-neutral-500">正在切分与结构化，通常 10–60 秒（AI 逐题组补答案）。</p> : null}
      {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
    </div>
  )
}
