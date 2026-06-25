'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles, Play, FileSpreadsheet, Pencil, ClipboardCheck, CheckCheck, UserX, BarChart3, CheckCircle2 } from 'lucide-react'
import { runGrading, overrideScore, getSubmissionMediaUrl, acceptAiForAssignment, markMissing as markMissingAction, batchOverride, savePhaseGradingConfig } from '@/actions/grading'
import { estimateGrading, formatTokens } from '@/lib/ai/cost'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge, statusTone } from '@/components/ui/badge'
import { GradeFocus } from './grade-focus'

interface Row {
  id: number
  studentName: string
  studentNo: string
  className: string
  phaseId: number
  phaseOrder?: number
  phaseLabel?: string
  status: string
  needsReview: boolean
  aiScore: number | null
  finalScore: number | null
  feedback: string
  hasVideo: boolean
  hasAudio: boolean
  hasImage: boolean
  durationSec: number
  recitedText: string
  violations: number
}
interface ModelOpt { id: string; label: string }
// 一个可 AI 评阅的环节 + 它当前保存的批阅配置（评分标准 + 感知/评分模型）。
interface PhaseCfg { id: number; label: string; rubric: string; perceptionModel: string; judgeModel: string; sentenceCount: number }
interface PollResult { phaseLabel?: string; total: number; correctChoice: string | null; correctCount: number | null; options: { label: string; count: number; correct: boolean }[] }

const SELECT = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm'

export function GradingClient(props: {
  assignmentId: number
  title: string
  category?: string | null
  sentenceCount: number
  studentCount: number
  classes: { id: number; name: string }[]
  rows: Row[]
  pollResults: PollResult[]
  phases: PhaseCfg[]
  notSubmitted: { name: string; studentNo: string }[]
  perceptionModels: ModelOpt[]
  judgeModels: ModelOpt[]
  defaultRubric: string
}) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const defaultPerception = props.perceptionModels[0]?.id ?? ''
  const defaultJudge = props.judgeModels[0]?.id ?? ''
  // 每环节一套批阅配置（评分标准 + 感知/评分模型）。初值取该环节已保存的，空则回退到
  // 默认模型 / 默认评分标准。逐条评阅、本环节全部评阅、聚焦评阅都按各自环节的这套配置走。
  const seedCfg = (p: PhaseCfg) => ({
    rubric: p.rubric || props.defaultRubric,
    perceptionModel: p.perceptionModel || defaultPerception,
    judgeModel: p.judgeModel || defaultJudge,
  })
  const [cfgByPhase, setCfgByPhase] = useState<Record<number, { rubric: string; perceptionModel: string; judgeModel: string }>>(
    () => Object.fromEntries(props.phases.map((p) => [p.id, seedCfg(p)])),
  )
  const cfgFor = (phaseId: number) => cfgByPhase[phaseId] ?? { rubric: props.defaultRubric, perceptionModel: defaultPerception, judgeModel: defaultJudge }
  const patchCfg = (phaseId: number, patch: Partial<{ rubric: string; perceptionModel: string; judgeModel: string }>) =>
    setCfgByPhase((prev) => ({ ...prev, [phaseId]: { ...cfgFor(phaseId), ...patch } }))

  const [editing, setEditing] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [phaseFilter, setPhaseFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [reviewOnly, setReviewOnly] = useState(false)
  const [focusIdx, setFocusIdx] = useState<number | null>(null)
  // Snapshot the worklist when focus opens so a background refresh (after each save)
  // can't shift the list under the index — otherwise the index would point at a
  // different submission, especially with the "only to-review" filter on.
  const [focusRows, setFocusRows] = useState<Row[]>([])
  // Multi-select for batch grading.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [batchScore, setBatchScore] = useState('')
  const [batchFeedback, setBatchFeedback] = useState('')

  // AI-first triage: rows the AI has handed to the teacher vs. ones it finished.
  const submitted = useMemo(() => props.rows.filter((r) => r.status !== 'DRAFT' && r.status !== 'MISSING'), [props.rows])
  const reviewQueue = useMemo(() => submitted.filter((r) => r.needsReview), [submitted])
  const aiAcceptable = useMemo(() => reviewQueue.filter((r) => r.aiScore != null).length, [reviewQueue])
  const doneCount = submitted.length - reviewQueue.length

  // The AI-gradable queue for a phase = its UPLOADED/FLAGGED rows (matches what
  // "本环节全部 AI 评阅" runs and what the token/费用 estimate is computed over).
  const pendingForPhase = (phaseId: number) => props.rows.filter((r) => r.phaseId === phaseId && (r.status === 'UPLOADED' || r.status === 'FLAGGED'))
  const statuses = useMemo(() => [...new Set(props.rows.map((r) => r.status))], [props.rows])
  // 列表的「按环节」筛选覆盖所有有提交的环节（含自由文本/手写，不止能 AI 评阅的）。
  const phaseOptions = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of props.rows) if (r.phaseId && !m.has(r.phaseId)) m.set(r.phaseId, r.phaseLabel ?? '')
    return [...m.entries()].map(([id, label]) => ({ id, label }))
  }, [props.rows])
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return props.rows.filter(
      (r) =>
        (!reviewOnly || (r.needsReview && r.status !== 'DRAFT')) &&
        (!statusFilter || r.status === statusFilter) &&
        (!phaseFilter || r.phaseId === Number(phaseFilter)) &&
        (!needle || r.studentName.toLowerCase().includes(needle) || r.studentNo.toLowerCase().includes(needle)),
    )
  }, [props.rows, statusFilter, phaseFilter, search, reviewOnly])

  const toggleSel = (id: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id))
  function toggleAllVisible() {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allVisibleSelected) visibleRows.forEach((r) => n.delete(r.id))
      else visibleRows.forEach((r) => n.add(r.id))
      return n
    })
  }
  function applyBatch() {
    const sc = batchScore.trim()
    const scoreNum = sc === '' ? null : Number(sc)
    if (scoreNum == null && !batchFeedback.trim()) { setError(t('grade.batchNeedField')); return }
    if (!confirm(t('grade.batchConfirm', { n: selected.size }))) return
    setError(null)
    startTransition(async () => {
      const res = await batchOverride(props.assignmentId, [...selected], scoreNum, batchFeedback)
      if (res.error) setError(res.error)
      else { setSelected(new Set()); setBatchScore(''); setBatchFeedback(''); router.refresh() }
    })
  }

  function markMissing() {
    if (!confirm(t('grade.markMissingConfirm', { n: props.notSubmitted.length }))) return
    setError(null)
    startTransition(async () => {
      const res = await markMissingAction(props.assignmentId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  function acceptAi() {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('assignmentId', String(props.assignmentId))
      const res = await acceptAiForAssignment(null, fd)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  // Grade one submission with ITS phase's saved config (the per-row 「AI 评阅」 button).
  function grade(submissionId: number, phaseId: number) {
    const cfg = cfgFor(phaseId)
    setError(null)
    setBusyId(submissionId)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('submissionId', String(submissionId))
      fd.set('perceptionModel', cfg.perceptionModel)
      fd.set('judgeModel', cfg.judgeModel)
      fd.set('rubric', cfg.rubric)
      const res = await runGrading(null, fd)
      setBusyId(null)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  // 本环节全部 AI 评阅：对该环节所有待评且有视频的逐个跑（手动重评只支持视频；音频靠提交
  // 时的自动评阅）。按本环节配置。
  function gradePhase(phaseId: number) {
    const cfg = cfgFor(phaseId)
    const ids = pendingForPhase(phaseId).filter((r) => r.hasVideo).map((r) => r.id)
    if (ids.length === 0) return
    setError(null)
    startTransition(async () => {
      for (const id of ids) {
        const fd = new FormData()
        fd.set('submissionId', String(id))
        fd.set('perceptionModel', cfg.perceptionModel)
        fd.set('judgeModel', cfg.judgeModel)
        fd.set('rubric', cfg.rubric)
        const res = await runGrading(null, fd)
        if (res.error) { setError(res.error); break }
      }
      router.refresh()
    })
  }

  // 保存本环节批阅配置到该环节（之后自动评阅 / 重评都按此执行）。
  function savePhaseCfg(phaseId: number) {
    const cfg = cfgFor(phaseId)
    setError(null)
    startTransition(async () => {
      const res = await savePhaseGradingConfig(props.assignmentId, phaseId, cfg.rubric, cfg.perceptionModel, cfg.judgeModel)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  async function watch(submissionId: number, kind: 'video' | 'audio' | 'image') {
    setError(null)
    const res = await getSubmissionMediaUrl(submissionId, kind)
    if (res.error) setError(res.error)
    else if (res.url) window.open(res.url, '_blank')
  }

  function saveOverride(submissionId: number, score: string, feedback: string) {
    setBusyId(submissionId)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('submissionId', String(submissionId))
      fd.set('score', score)
      fd.set('feedback', feedback)
      const res = await overrideScore(null, fd)
      setBusyId(null)
      if (res.error) setError(res.error)
      else { setEditing(null); router.refresh() }
    })
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          {props.category ? <Badge tone="primary" className="mb-1">{props.category}</Badge> : null}
          <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
          <p className="text-sm text-muted-foreground">{props.sentenceCount} {t('asg.sentences')} · {props.studentCount} {t('grade.students')}</p>
        </div>
        <Link href={`/dashboard/assignments/${props.assignmentId}/edit`}>
          <Button variant="outline" size="sm"><Pencil className="h-4 w-4" />{t('asg.edit')}</Button>
        </Link>
      </div>

      {submitted.length > 0 ? (
        <Card className={reviewQueue.length > 0 ? 'border-primary/30 bg-primary/5' : ''}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t('grade.reviewTitle')}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t('grade.reviewSummary', { done: doneCount, total: submitted.length })}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-3xl font-extrabold leading-none tabular-nums">{reviewQueue.length}</div>
                <div className="text-[11px] text-muted-foreground">{t('grade.toReview')}</div>
              </div>
            </div>
            {reviewQueue.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={reviewOnly ? 'default' : 'outline'} onClick={() => setReviewOnly((v) => !v)}>
                  <ClipboardCheck className="h-3.5 w-3.5" />{t('grade.reviewOnly')}
                </Button>
                {aiAcceptable > 0 ? (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={acceptAi}>
                    <CheckCheck className="h-3.5 w-3.5" />{t('grade.acceptAll')}（{aiAcceptable}）
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-success"><CheckCheck className="h-4 w-4" />{t('grade.allReviewed')}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {props.pollResults.map((poll, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              {t('grade.pollResults')}{poll.phaseLabel ? ` · ${poll.phaseLabel}` : ''}
            </CardTitle>
            <CardDescription>
              {t('grade.pollTotal', { n: poll.total })}
              {poll.correctChoice != null
                ? ` · ${t('grade.correctRate', { pct: poll.total > 0 ? Math.round(((poll.correctCount ?? 0) / poll.total) * 100) : 0 })}`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {poll.options.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('grade.pollNoOptions')}</p>
            ) : (
              poll.options.map((o, j) => {
                const pct = poll.total > 0 ? Math.round((o.count / poll.total) * 100) : 0
                return (
                  <div key={j} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className={'flex min-w-0 flex-1 items-center gap-1.5 whitespace-pre-wrap break-words ' + (o.correct ? 'font-medium text-success' : '')}>
                        {o.correct ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : null}{o.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{o.count} · {pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className={'h-full rounded-full ' + (o.correct ? 'bg-success' : 'bg-primary')} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      ))}

      {props.notSubmitted.length > 0 ? (
        <Card className="border-[hsl(var(--warning))]/30 bg-warning/5">
          <CardContent className="p-4">
            <details>
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[hsl(var(--warning))]">
                  <UserX className="h-4 w-4" />{t('grade.notSubmitted')}
                </span>
                <span className="text-2xl font-extrabold tabular-nums text-[hsl(var(--warning))]">{props.notSubmitted.length}</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {props.notSubmitted.map((s) => (
                  <span key={s.studentNo} className="rounded-lg bg-secondary px-2 py-1 text-xs">
                    {s.name}<span className="ml-1 text-muted-foreground">{s.studentNo}</span>
                  </span>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-3" disabled={pending} onClick={markMissing}>
                {t('grade.markMissing', { n: props.notSubmitted.length })}
              </Button>
            </details>
          </CardContent>
        </Card>
      ) : null}

      {props.phases.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('grade.cfgTitle')}</CardTitle>
            <CardDescription>{t('grade.cfgDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {props.phases.map((p) => {
              const cfg = cfgFor(p.id)
              const pend = pendingForPhase(p.id)
              const est = estimateGrading(
                pend.map((r) => ({ hasVideo: r.hasVideo, hasAudio: r.hasAudio, hasImage: r.hasImage, durationSec: r.durationSec, recitedLen: r.recitedText.length })),
                { perceptionModel: cfg.perceptionModel, judgeModel: cfg.judgeModel, rubricLen: cfg.rubric.length, sentencesLen: p.sentenceCount * 50 },
              )
              const body = (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>{t('grade.perceptionModel')}</Label>
                      <select value={cfg.perceptionModel} onChange={(e) => patchCfg(p.id, { perceptionModel: e.target.value })} className={SELECT} aria-label={t('grade.perceptionModel')}>
                        {props.perceptionModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t('grade.judgeModel')}</Label>
                      <select value={cfg.judgeModel} onChange={(e) => patchCfg(p.id, { judgeModel: e.target.value })} className={SELECT} aria-label={t('grade.judgeModel')}>
                        {props.judgeModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('grade.rubric')}</Label>
                    <Textarea value={cfg.rubric} onChange={(e) => patchCfg(p.id, { rubric: e.target.value })} rows={3} placeholder={t('grade.rubricPh')} />
                  </div>
                  <div className="rounded-xl bg-secondary p-3">
                    <div className="text-xs font-medium text-muted-foreground">{t('grade.estimate')}</div>
                    <div className="mt-1 text-sm">
                      {pend.length === 0
                        ? t('grade.estimateNone')
                        : t('grade.estimateLine', { n: pend.length, tokens: formatTokens(est.totalTokens), cny: est.cny.toFixed(2), usd: est.usd.toFixed(2) })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => savePhaseCfg(p.id)}>{t('grade.saveCfg')}</Button>
                    {pend.some((r) => r.hasVideo) ? (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => gradePhase(p.id)}>
                        <Sparkles className="h-4 w-4" />{t('grade.gradePhase', { n: pend.filter((r) => r.hasVideo).length })}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
              return props.phases.length === 1 ? (
                <div key={p.id}>{body}</div>
              ) : (
                <details key={p.id} className="rounded-xl border border-input">
                  <summary className="tap flex cursor-pointer items-center justify-between gap-2 p-3 text-sm font-medium">
                    <span className="min-w-0 truncate">{p.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{pend.length > 0 ? t('grade.pendN', { n: pend.length }) : t('grade.allReviewed')}</span>
                  </summary>
                  <div className="border-t border-border/60 p-3">{body}</div>
                </details>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {props.classes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('grade.exportTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {props.classes.map((c) => (
              <a key={c.id} href={`/dashboard/assignments/${props.assignmentId}/export?classId=${c.id}`}>
                <Button variant="outline" size="sm"><FileSpreadsheet className="h-4 w-4" />{c.name}</Button>
              </a>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {error ? <FormMessage>{error}</FormMessage> : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('grade.subTitle')}</CardTitle>
          {props.rows.length > 0 ? (
            <Button
              size="sm"
              onClick={() => {
                const first = visibleRows.findIndex((r) => r.needsReview && r.status !== 'DRAFT')
                setFocusRows(visibleRows)
                setFocusIdx(first >= 0 ? first : 0)
              }}
            >
              <ClipboardCheck className="h-4 w-4" />{t('grade.focus')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2">
          {props.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('grade.noSub')}</p>
          ) : (
            <>
            {phaseOptions.length > 1 ? (
              <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} className={SELECT} aria-label={t('grade.byPhase')}>
                <option value="">{t('grade.allPhases')}</option>
                {phaseOptions.map((p) => <option key={p.id} value={String(p.id)}>{p.label}</option>)}
              </select>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT} aria-label={t('grade.subTitle')}>
                <option value="">{t('filter.allStatus')}</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>{t('st.' + s)}</option>
                ))}
              </select>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('filter.searchStudent')} aria-label={t('filter.searchStudent')} className="h-11" />
            </div>

            {visibleRows.length > 0 ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-4 w-4 accent-primary" />
                  {t('grade.selectAll')}
                </label>
                {selected.size > 0 ? (
                  <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-primary hover:underline">{t('grade.clearSel', { n: selected.size })}</button>
                ) : null}
              </div>
            ) : null}
            {selected.size > 0 ? (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs font-medium">{t('grade.batchTitle', { n: selected.size })}</p>
                <div className="flex gap-2">
                  <Input value={batchScore} onChange={(e) => setBatchScore(e.target.value)} type="number" min={0} max={100} placeholder={t('grade.score')} aria-label={t('grade.score')} className="h-10 w-24" />
                  <Input value={batchFeedback} onChange={(e) => setBatchFeedback(e.target.value)} placeholder={t('grade.batchFeedbackPh')} aria-label={t('grade.batchFeedbackPh')} className="h-10 flex-1" />
                </div>
                <Button size="sm" className="w-full" disabled={pending} onClick={applyBatch}>{t('grade.batchApply', { n: selected.size })}</Button>
              </div>
            ) : null}

            {visibleRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('filter.none')}</p>
            ) : null}
            {visibleRows.map((r) => (
              <div key={r.id} className={'rounded-xl border p-3 text-sm ' + (selected.has(r.id) ? 'border-primary bg-primary/5' : 'border-border/70')}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} className="h-4 w-4 shrink-0 accent-primary" aria-label={r.studentName} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{r.studentName} <span className="text-muted-foreground">{r.studentNo}</span></div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{r.className}</span>
                      {r.phaseLabel ? <Badge tone="primary">{r.phaseLabel}</Badge> : null}
                      <Badge tone={statusTone(r.status)}>{t('st.' + r.status)}</Badge>
                      {r.needsReview && r.status !== 'DRAFT' ? <Badge tone="warning">{t('grade.needsReview')}</Badge> : null}
                      {r.violations > 0 ? <span className="text-[hsl(var(--warning))]">⚠️ {r.violations} {t('grade.leftCount')}</span> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {r.finalScore != null ? <div className="text-xl font-extrabold">{r.finalScore}</div> : <div className="text-muted-foreground">—</div>}
                    {r.aiScore != null ? <div className="text-[11px] text-muted-foreground">AI {r.aiScore}</div> : null}
                  </div>
                </div>
                {r.feedback ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{r.feedback}</p> : null}
                {r.recitedText ? (
                  <details className="mt-1.5 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{t('grade.text')}</summary>
                    <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-secondary p-2 font-sans">{r.recitedText}</pre>
                  </details>
                ) : null}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" disabled={pending && busyId === r.id} onClick={() => grade(r.id, r.phaseId)}>
                    <Sparkles className="h-3.5 w-3.5" />{busyId === r.id && pending ? t('grade.running') : t('grade.run')}
                  </Button>
                  {r.hasVideo ? <Button size="sm" variant="outline" onClick={() => watch(r.id, 'video')}><Play className="h-3.5 w-3.5" />{t('grade.watch')}</Button> : null}
                  {r.hasAudio ? <Button size="sm" variant="outline" onClick={() => watch(r.id, 'audio')}><Play className="h-3.5 w-3.5" />{t('grade.listen')}</Button> : null}
                  {r.hasImage ? <Button size="sm" variant="outline" onClick={() => watch(r.id, 'image')}><Play className="h-3.5 w-3.5" />{t('grade.viewImage')}</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === r.id ? null : r.id)}>{t('grade.override')}</Button>
                </div>
                {editing === r.id ? <OverrideForm row={r} disabled={pending} t={t} onSave={(s, fb) => saveOverride(r.id, s, fb)} /> : null}
              </div>
            ))}
            </>
          )}
        </CardContent>
      </Card>

      {focusIdx !== null && focusRows[focusIdx] ? (
        <GradeFocus
          rows={focusRows}
          index={focusIdx}
          setIndex={setFocusIdx}
          onClose={() => setFocusIdx(null)}
          cfgFor={cfgFor}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  )
}

function OverrideForm({ row, disabled, t, onSave }: { row: Row; disabled: boolean; t: (k: string) => string; onSave: (score: string, feedback: string) => void }) {
  const [score, setScore] = useState(row.finalScore != null ? String(row.finalScore) : '')
  const [feedback, setFeedback] = useState(row.feedback)
  return (
    <div className="mt-2.5 space-y-2 border-t border-border/60 pt-2.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={`score-${row.id}`} className="w-14">{t('grade.score')}</Label>
        <Input id={`score-${row.id}`} value={score} onChange={(e) => setScore(e.target.value)} type="number" min={0} max={100} className="h-10 w-24" />
      </div>
      <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} />
      <Button size="sm" disabled={disabled} onClick={() => onSave(score, feedback)}>{t('grade.saveScore')}</Button>
    </div>
  )
}
