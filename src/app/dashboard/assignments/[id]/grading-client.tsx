'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles, Play, FileSpreadsheet, Pencil, ClipboardCheck } from 'lucide-react'
import { runGrading, overrideScore, getSubmissionMediaUrl } from '@/actions/grading'
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
  status: string
  aiScore: number | null
  finalScore: number | null
  feedback: string
  hasVideo: boolean
  hasAudio: boolean
  recitedText: string
  violations: number
}
interface ModelOpt { id: string; label: string }
interface Preset { id: string; label: string; perceptionModel: string; judgeModel: string }

const SELECT = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm'

export function GradingClient(props: {
  assignmentId: number
  title: string
  sentenceCount: number
  classes: { id: number; name: string }[]
  rows: Row[]
  presets: Preset[]
  perceptionModels: ModelOpt[]
  judgeModels: ModelOpt[]
  defaultRubric: string
}) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [presetId, setPresetId] = useState(props.presets[0]?.id ?? '')
  const [advanced, setAdvanced] = useState(false)
  const preset = props.presets.find((p) => p.id === presetId)
  const [perceptionModel, setPerceptionModel] = useState(preset?.perceptionModel ?? props.perceptionModels[0]?.id ?? '')
  const [judgeModel, setJudgeModel] = useState(preset?.judgeModel ?? props.judgeModels[0]?.id ?? '')
  const [rubric, setRubric] = useState(props.defaultRubric)
  const [editing, setEditing] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [focusIdx, setFocusIdx] = useState<number | null>(null)

  const effPerception = advanced ? perceptionModel : preset?.perceptionModel ?? perceptionModel
  const effJudge = advanced ? judgeModel : preset?.judgeModel ?? judgeModel
  const pendingCount = useMemo(
    () => props.rows.filter((r) => r.status === 'UPLOADED' || r.status === 'FLAGGED').length,
    [props.rows],
  )
  const statuses = useMemo(() => [...new Set(props.rows.map((r) => r.status))], [props.rows])
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return props.rows.filter(
      (r) =>
        (!statusFilter || r.status === statusFilter) &&
        (!needle || r.studentName.toLowerCase().includes(needle) || r.studentNo.toLowerCase().includes(needle)),
    )
  }, [props.rows, statusFilter, search])

  function grade(submissionId: number) {
    setError(null)
    setBusyId(submissionId)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('submissionId', String(submissionId))
      fd.set('perceptionModel', effPerception)
      fd.set('judgeModel', effJudge)
      fd.set('rubric', rubric)
      const res = await runGrading(null, fd)
      setBusyId(null)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  async function watch(submissionId: number, kind: 'video' | 'audio') {
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
          <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
          <p className="text-sm text-muted-foreground">{props.sentenceCount} {t('asg.sentences')} · {props.rows.length} {t('grade.students')}</p>
        </div>
        <Link href={`/dashboard/assignments/${props.assignmentId}/edit`}>
          <Button variant="outline" size="sm"><Pencil className="h-4 w-4" />{t('asg.edit')}</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('grade.settings')}</CardTitle>
          <CardDescription>{t('grade.settingsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!advanced ? (
            <div className="space-y-1.5">
              <Label>{t('grade.preset')}</Label>
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className={SELECT}>
                {props.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('grade.perceptionModel')}</Label>
                <select value={perceptionModel} onChange={(e) => setPerceptionModel(e.target.value)} className={SELECT}>
                  {props.perceptionModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('grade.judgeModel')}</Label>
                <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} className={SELECT}>
                  {props.judgeModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            {t('grade.advanced')}
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="rubric">{t('grade.rubric')}</Label>
            <Textarea id="rubric" value={rubric} onChange={(e) => setRubric(e.target.value)} rows={3} placeholder={t('grade.rubricPh')} />
          </div>
          {pendingCount > 0 ? (
            <Button variant="secondary" disabled={pending}
              onClick={() => props.rows.filter((r) => r.status === 'UPLOADED' || r.status === 'FLAGGED').forEach((r) => grade(r.id))}>
              <Sparkles className="h-4 w-4" />{t('grade.gradeAll')}（{pendingCount}）
            </Button>
          ) : null}
        </CardContent>
      </Card>

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
                const first = visibleRows.findIndex((r) => r.status === 'UPLOADED' || r.status === 'FLAGGED')
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
            <div className="grid grid-cols-2 gap-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT} aria-label={t('grade.subTitle')}>
                <option value="">{t('filter.allStatus')}</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>{t('st.' + s)}</option>
                ))}
              </select>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('filter.searchStudent')} className="h-11" />
            </div>
            {visibleRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('filter.none')}</p>
            ) : null}
            {visibleRows.map((r) => (
              <div key={r.id} className="rounded-xl border border-border/70 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{r.studentName} <span className="text-muted-foreground">{r.studentNo}</span></div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{r.className}</span>
                      <Badge tone={statusTone(r.status)}>{t('st.' + r.status)}</Badge>
                      {r.violations > 0 ? <span className="text-[hsl(var(--warning))]">⚠️ {r.violations} {t('grade.leftCount')}</span> : null}
                    </div>
                  </div>
                  <div className="text-right">
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
                  <Button size="sm" disabled={pending && busyId === r.id} onClick={() => grade(r.id)}>
                    <Sparkles className="h-3.5 w-3.5" />{busyId === r.id && pending ? t('grade.running') : t('grade.run')}
                  </Button>
                  {r.hasVideo ? <Button size="sm" variant="outline" onClick={() => watch(r.id, 'video')}><Play className="h-3.5 w-3.5" />{t('grade.watch')}</Button> : null}
                  {r.hasAudio ? <Button size="sm" variant="outline" onClick={() => watch(r.id, 'audio')}><Play className="h-3.5 w-3.5" />{t('grade.listen')}</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === r.id ? null : r.id)}>{t('grade.override')}</Button>
                </div>
                {editing === r.id ? <OverrideForm row={r} disabled={pending} t={t} onSave={(s, fb) => saveOverride(r.id, s, fb)} /> : null}
              </div>
            ))}
            </>
          )}
        </CardContent>
      </Card>

      {focusIdx !== null && visibleRows[focusIdx] ? (
        <GradeFocus
          rows={visibleRows}
          index={focusIdx}
          setIndex={setFocusIdx}
          onClose={() => setFocusIdx(null)}
          perceptionModel={effPerception}
          judgeModel={effJudge}
          rubric={rubric}
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
