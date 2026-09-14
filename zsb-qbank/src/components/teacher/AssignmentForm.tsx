'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ITEM_TYPE_LABEL, itemPreview } from '@/lib/teacher/item-preview'

// 发布任务表单(SPEC §8「组卷与发布」):试卷(整卷 / 勾选小题)、班级、模式、开放与截止、
// 考试时长、解析可见、成绩发布方式。题单来自 GET /api/teacher/papers/:id(教师接口,含答案,
// 但本表单只用题号/题型/摘要)。POST /api/teacher/assignments。

export interface PaperOption {
  id: string
  title: string
  durationMinutes: number
  totalScore: number
}
export interface ClassOption {
  id: string
  name: string
  members: number
}
interface PickerItem {
  id: string
  number: number
  type: string
  score: number
  content: unknown
  contextSnippet: string | null
}
interface PickerSection {
  id: string
  code: string
  title: string
  groups: { id: string; items: PickerItem[] }[]
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function toIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function AssignmentForm({ papers, classes, initialPaperId, initialClassId }: { papers: PaperOption[]; classes: ClassOption[]; initialPaperId?: string; initialClassId?: string }) {
  const router = useRouter()
  const [paperId, setPaperId] = useState(initialPaperId && papers.some((p) => p.id === initialPaperId) ? initialPaperId : (papers[0]?.id ?? ''))
  const [classId, setClassId] = useState(initialClassId && classes.some((c) => c.id === initialClassId) ? initialClassId : (classes[0]?.id ?? ''))
  const [mode, setMode] = useState<'practice' | 'exam'>('practice')
  const [title, setTitle] = useState('')
  const [scope, setScope] = useState<'all' | 'pick'>('all')
  const [sections, setSections] = useState<PickerSection[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [opensAt, setOpensAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [duration, setDuration] = useState('')
  const [showExplanation, setShowExplanation] = useState(true)
  const [release, setRelease] = useState<'on_submit' | 'manual'>('manual')
  const [allowRetake, setAllowRetake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const paper = papers.find((p) => p.id === paperId)

  // 默认标题跟随试卷 + 模式(老师没改过才跟随)。
  const [titleTouched, setTitleTouched] = useState(false)
  useEffect(() => {
    if (!titleTouched && paper) setTitle(`${paper.title} · ${mode === 'exam' ? '考试' : '练习'}`)
  }, [paper, mode, titleTouched])

  // 勾选小题时才拉题单。
  useEffect(() => {
    if (scope !== 'pick' || !paperId) return
    let alive = true
    setSections(null)
    void (async () => {
      try {
        const res = await fetch(`/api/teacher/papers/${encodeURIComponent(paperId)}`)
        if (!res.ok) throw new Error('bad')
        const j = (await res.json()) as { paper: { sections: PickerSection[] } }
        if (alive) setSections(j.paper.sections)
      } catch {
        if (alive) setErr('题单加载失败，刷新再试')
      }
    })()
    return () => {
      alive = false
    }
  }, [scope, paperId])
  useEffect(() => setPicked(new Set()), [paperId])

  const pickedScore = useMemo(() => {
    if (!sections) return 0
    let s = 0
    for (const sec of sections) for (const g of sec.groups) for (const it of g.items) if (picked.has(it.id)) s += it.score
    return s
  }, [sections, picked])

  const toggleSection = (sec: PickerSection, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev)
      for (const g of sec.groups) {
        for (const it of g.items) {
          if (on) next.add(it.id)
          else next.delete(it.id)
        }
      }
      return next
    })
  }

  const submit = () => {
    setErr(null)
    if (!paperId || !classId) return setErr('请选择试卷和班级')
    if (scope === 'pick' && picked.size === 0) return setErr('请至少勾选一道小题')
    const body: Record<string, unknown> = {
      classId,
      paperId,
      mode,
      title: title.trim(),
      opensAt: toIso(opensAt),
      dueAt: toIso(dueAt),
      settings: { showExplanation, release, allowRetake },
    }
    if (scope === 'pick') body.itemIds = [...picked]
    if (mode === 'exam' && duration.trim()) body.durationMinutes = Number(duration)
    setBusy(true)
    void (async () => {
      try {
        const res = await fetch('/api/teacher/assignments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const j = (await res.json().catch(() => null)) as { assignment?: { id: string }; error?: { message?: string } } | null
        if (!res.ok || !j?.assignment) {
          setErr(j?.error?.message ?? '发布失败，再试一次')
          return
        }
        router.push(`/teacher/assignments/${j.assignment.id}`)
        router.refresh()
      } catch {
        setErr('网络不太好，再试一次')
      } finally {
        setBusy(false)
      }
    })()
  }

  const field = 'mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900'
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">
        <span className="text-neutral-500">试卷</span>
        <select value={paperId} onChange={(e) => setPaperId(e.target.value)} className={field}>
          {papers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}（{p.totalScore} 分 / {p.durationMinutes} 分钟）
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-neutral-500">班级</span>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className={field}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{c.members} 人）
            </option>
          ))}
        </select>
        {classes.length === 0 ? <span className="mt-1 block text-red-600">还没有班级，先去「班级」新建。</span> : null}
      </label>
      <div className="text-sm">
        <span className="text-neutral-500">模式</span>
        <div className="mt-1 flex gap-4">
          {(['practice', 'exam'] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'exam' ? '考试（交卷后统一出分、可限时）' : '练习（做完一组就对答案）'}
            </label>
          ))}
        </div>
      </div>
      <label className="text-sm">
        <span className="text-neutral-500">任务名称</span>
        <input
          value={title}
          onChange={(e) => {
            setTitleTouched(true)
            setTitle(e.target.value)
          }}
          maxLength={100}
          className={field}
        />
      </label>
      <div className="text-sm md:col-span-2">
        <span className="text-neutral-500">范围</span>
        <div className="mt-1 flex gap-4">
          <label className="flex items-center gap-1">
            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} /> 整卷
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="scope" checked={scope === 'pick'} onChange={() => setScope('pick')} /> 勾选小题
            {scope === 'pick' ? (
              <span className="ml-2 text-neutral-500">
                已选 {picked.size} 题 · {pickedScore} 分
              </span>
            ) : null}
          </label>
        </div>
        {scope === 'pick' ? (
          <div className="mt-2 max-h-96 overflow-auto rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            {!sections ? (
              <p className="text-neutral-400">题单加载中…</p>
            ) : (
              sections.map((sec) => {
                const ids = sec.groups.flatMap((g) => g.items.map((it) => it.id))
                const allOn = ids.length > 0 && ids.every((id) => picked.has(id))
                return (
                  <div key={sec.id} className="mb-3">
                    <label className="flex items-center gap-2 font-medium">
                      <input type="checkbox" checked={allOn} onChange={(e) => toggleSection(sec, e.target.checked)} />
                      {sec.code} {sec.title}
                    </label>
                    <ul className="mt-1 pl-6">
                      {sec.groups.flatMap((g) =>
                        g.items.map((it) => (
                          <li key={it.id}>
                            <label className="flex items-start gap-2 py-0.5">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={picked.has(it.id)}
                                onChange={(e) =>
                                  setPicked((prev) => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(it.id)
                                    else next.delete(it.id)
                                    return next
                                  })
                                }
                              />
                              <span>
                                <span className="font-mono">{it.number}.</span> <span className="text-neutral-500">[{ITEM_TYPE_LABEL[it.type] ?? it.type} · {it.score} 分]</span>{' '}
                                {itemPreview(it.type, it.content, it.contextSnippet)}
                              </span>
                            </label>
                          </li>
                        )),
                      )}
                    </ul>
                  </div>
                )
              })
            )}
          </div>
        ) : null}
      </div>
      <label className="text-sm">
        <span className="text-neutral-500">开放时间（留空 = 立即）</span>
        <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className={field} />
      </label>
      <label className="text-sm">
        <span className="text-neutral-500">截止时间（留空 = 不截止）</span>
        <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={field} />
        <span className="mt-1 block text-xs text-neutral-400">
          常用：
          <button type="button" className="ml-1 text-blue-600" onClick={() => setDueAt(toLocalInput(new Date(Date.now() + 2 * 3600_000)))}>
            2 小时后
          </button>
          <button type="button" className="ml-2 text-blue-600" onClick={() => setDueAt(toLocalInput(new Date(Date.now() + 24 * 3600_000)))}>
            明天此时
          </button>
          <button type="button" className="ml-2 text-blue-600" onClick={() => setDueAt(toLocalInput(new Date(Date.now() + 7 * 24 * 3600_000)))}>
            一周后
          </button>
        </span>
      </label>
      {mode === 'exam' ? (
        <label className="text-sm">
          <span className="text-neutral-500">考试时长（分钟，留空 = 试卷默认 {paper?.durationMinutes ?? '—'}）</span>
          <input type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} className={field} />
        </label>
      ) : null}
      <div className="text-sm md:col-span-2">
        <span className="text-neutral-500">反馈设置</span>
        <div className="mt-1 flex flex-wrap gap-6">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showExplanation} onChange={(e) => setShowExplanation(e.target.checked)} /> 出分时显示解析
          </label>
          <label className="flex items-center gap-1">
            成绩发布
            <select value={release} onChange={(e) => setRelease(e.target.value as 'on_submit' | 'manual')} className="ml-1 rounded-lg border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900">
              <option value="manual">老师手动发布</option>
              <option value="on_submit">交卷即发布</option>
            </select>
          </label>
          {mode === 'exam' ? (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={allowRetake} onChange={(e) => setAllowRetake(e.target.checked)} /> 允许重考
            </label>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-neutral-400">练习模式每组即时反馈不受此影响；考试模式发布前学生只看到「已交卷」。</p>
      </div>
      <div className="md:col-span-2">
        <button type="button" disabled={busy || classes.length === 0 || papers.length === 0} onClick={submit} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-60">
          {busy ? '发布中…' : '发布任务'}
        </button>
        {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      </div>
    </div>
  )
}
