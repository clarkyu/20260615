'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react'
import { runGrading, overrideScore, getSubmissionMediaUrl, getShadowTakeUrls } from '@/actions/grading'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge, statusTone } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export interface FocusRow {
  id: number
  studentName: string
  studentNo: string
  phaseId: number
  status: string
  aiScore: number | null
  finalScore: number | null
  feedback: string
  hasVideo: boolean
  hasAudio: boolean
  hasImage: boolean
  recitedText: string
  violations: number
}

// Full-screen, one-submission-at-a-time grading: big video, AI suggestion,
// quick score + feedback, save & advance.
export function GradeFocus({
  rows,
  index,
  setIndex,
  onClose,
  cfgFor,
  onChanged,
}: {
  rows: FocusRow[]
  index: number
  setIndex: (i: number) => void
  onClose: () => void
  // 按聚焦中那一份提交所属环节，取该环节的批阅配置（评分标准 + 模型）。
  cfgFor: (phaseId: number) => { perceptionModel: string; judgeModel: string; rubric: string }
  onChanged: () => void
}) {
  const t = useT()
  const cur = rows[index]
  const curId = cur?.id
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [takes, setTakes] = useState<{ order: number; url: string; score: number | null; spokenText: string | null }[]>([])
  const [score, setScore] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the editable fields and load the media whenever the focused row changes.
  // (Intentionally keyed on the id only, so a background refresh doesn't wipe edits.)
  useEffect(() => {
    if (!cur) return
    setScore(cur.finalScore != null ? String(cur.finalScore) : cur.aiScore != null ? String(cur.aiScore) : '')
    setFeedback(cur.feedback)
    setVideoUrl(null)
    setAudioUrl(null)
    setImageUrl(null)
    setTakes([])
    setError(null)
    let active = true
    if (cur.hasVideo) getSubmissionMediaUrl(cur.id, 'video').then((r) => { if (active && r.url) setVideoUrl(r.url) })
    if (cur.hasAudio) getSubmissionMediaUrl(cur.id, 'audio').then((r) => { if (active && r.url) setAudioUrl(r.url) })
    if (cur.hasImage) getSubmissionMediaUrl(cur.id, 'image').then((r) => { if (active && r.url) setImageUrl(r.url) })
    getShadowTakeUrls(cur.id).then((r) => { if (active && r.takes && r.takes.length) setTakes(r.takes) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId])

  // Power-user keyboard shortcuts for fast grading. Ignored while typing in a field
  // (except Escape). ← → navigate · S save & next · A accept AI · R run AI.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (e.key === 'ArrowLeft') { if (index > 0) setIndex(index - 1) }
      else if (e.key === 'ArrowRight') { if (index < rows.length - 1) setIndex(index + 1) }
      else if (k === 's') { e.preventDefault(); if (!busy) void save(true) }
      else if (k === 'a') { if (cur && cur.aiScore != null) { setScore(String(cur.aiScore)); if (cur.feedback) setFeedback(cur.feedback) } }
      else if (k === 'r') { if (!busy) void runAi() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, rows.length, onClose, cur, busy, score, feedback])

  if (!cur) return null

  async function runAi() {
    setBusy(true); setError(null)
    const cfg = cfgFor(cur.phaseId)
    const fd = new FormData()
    fd.set('submissionId', String(cur.id))
    fd.set('perceptionModel', cfg.perceptionModel)
    fd.set('judgeModel', cfg.judgeModel)
    fd.set('rubric', cfg.rubric)
    const res = await runGrading(null, fd)
    setBusy(false)
    if (res.error) setError(res.error)
    else onChanged()
  }

  async function save(advance: boolean) {
    setBusy(true); setError(null)
    const fd = new FormData()
    fd.set('submissionId', String(cur.id))
    fd.set('score', score)
    fd.set('feedback', feedback)
    const res = await overrideScore(null, fd)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    onChanged()
    if (advance && index < rows.length - 1) setIndex(index + 1)
    else if (advance) onClose()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('grade.focus')} className="safe-bottom safe-top fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" />{t('grade.close')}</Button>
        <span className="text-sm font-medium text-muted-foreground">{index + 1} / {rows.length}</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold">{cur.studentName} <span className="text-muted-foreground">{cur.studentNo}</span></div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={statusTone(cur.status)}>{t('st.' + cur.status)}</Badge>
              {cur.violations > 0 ? <span className="text-xs text-warning">⚠️ {cur.violations} {t('grade.leftCount')}</span> : null}
            </div>
          </div>
          {cur.finalScore != null ? <div className="text-3xl font-extrabold leading-none">{cur.finalScore}</div> : null}
        </div>

        {cur.hasVideo ? (
          videoUrl ? (
            <video src={videoUrl} controls playsInline className="aspect-[3/4] w-full rounded-lg bg-black object-contain" />
          ) : (
            <Skeleton className="aspect-[3/4] w-full" />
          )
        ) : null}
        {cur.hasAudio ? (
          audioUrl ? <audio src={audioUrl} controls className="w-full" /> : <Skeleton className="h-16 w-full" />
        ) : null}
        {cur.hasImage ? (
          imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={imageUrl} alt="" className="w-full rounded-lg bg-secondary object-contain" />
            : <Skeleton className="h-28 w-full" />
        ) : null}
        {takes.length > 0 ? (
          <div className="space-y-1.5 rounded-xl border border-border/70 p-2.5">
            <div className="text-xs font-medium text-muted-foreground">{t('grade.shadowTakes')}（{takes.length}）</div>
            {takes.map((tk) => (
              <div key={tk.order} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{tk.order}</span>
                {tk.score != null ? (
                  <span className={'w-8 shrink-0 text-center text-xs font-bold tabular-nums ' + (tk.score < 60 ? 'text-warning' : 'text-success')}>{tk.score}</span>
                ) : null}
                <audio src={tk.url} controls className="h-8 min-w-0 flex-1" />
              </div>
            ))}
          </div>
        ) : null}
        {!cur.hasVideo && !cur.hasAudio && !cur.hasImage && takes.length === 0 ? (
          <div className="grid h-28 w-full place-items-center rounded-lg bg-secondary text-sm text-muted-foreground">{t('grade.noSub')}</div>
        ) : null}

        {cur.recitedText ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{t('grade.text')}</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-secondary p-2 font-sans">{cur.recitedText}</pre>
          </details>
        ) : null}

        <div className="rounded-xl border border-border/70 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t('grade.aiSuggest')}</span>
            <span className="text-lg font-bold">{cur.aiScore != null ? cur.aiScore : '—'}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={runAi}>
              <Sparkles className="h-3.5 w-3.5" />{busy ? t('grade.running') : t('grade.run')}
            </Button>
            {cur.aiScore != null ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setScore(String(cur.aiScore)); if (cur.feedback) setFeedback(cur.feedback) }}>
                {t('grade.acceptAi')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-14 text-sm text-muted-foreground">{t('grade.score')}</span>
            <Input value={score} onChange={(e) => setScore(e.target.value)} type="number" min={0} max={100} className="h-12 w-28 text-xl font-bold" />
          </div>
          <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} placeholder={t('grade.rubricPh')} aria-label={t('grade.rubricPh')} />
        </div>

        {error ? <FormMessage>{error}</FormMessage> : null}
      </div>

      <div className="border-t border-border/60 p-3">
        <p className="mb-2 hidden text-center text-[11px] text-muted-foreground sm:block">{t('grade.shortcuts')}</p>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
          <Button variant="outline" size="icon" disabled={index <= 0} onClick={() => setIndex(index - 1)}><ChevronLeft className="h-5 w-5" /></Button>
          <Button size="lg" disabled={busy} onClick={() => save(true)}>{t('grade.saveNext')}</Button>
          <Button variant="outline" size="icon" disabled={index >= rows.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight className="h-5 w-5" /></Button>
        </div>
      </div>
    </div>
  )
}
