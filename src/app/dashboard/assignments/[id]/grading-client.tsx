'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { runGrading, overrideScore, getSubmissionVideoUrl } from '@/actions/grading'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  recitedText: string
  violations: number
}
interface ModelOpt {
  id: string
  label: string
}
interface Preset {
  id: string
  label: string
  perceptionModel: string
  judgeModel: string
}

const STATUS: Record<string, string> = {
  DRAFT: '未提交',
  UPLOADED: '待评阅',
  PROCESSING: '评阅中',
  GRADED: '已评阅',
  FLAGGED: '需复核',
  FAILED: '失败',
}

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

  const effPerception = advanced ? perceptionModel : preset?.perceptionModel ?? perceptionModel
  const effJudge = advanced ? judgeModel : preset?.judgeModel ?? judgeModel

  const pendingCount = useMemo(
    () => props.rows.filter((r) => r.status === 'UPLOADED' || r.status === 'FLAGGED').length,
    [props.rows],
  )

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

  async function watch(submissionId: number) {
    setError(null)
    const res = await getSubmissionVideoUrl(submissionId)
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
      else {
        setEditing(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{props.title}</h1>
        <p className="text-sm text-muted-foreground">{props.sentenceCount} 句 · {props.rows.length} 名学生提交</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">评阅设置</CardTitle>
          <CardDescription>选择模型组合并填写评分标准（阅卷时提供）。AI 给分为参考，可人工改分。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!advanced ? (
            <div className="space-y-2">
              <Label>模型预设</Label>
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {props.presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>① 感知模型</Label>
                <select value={perceptionModel} onChange={(e) => setPerceptionModel(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {props.perceptionModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>② 评分模型</Label>
                <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {props.judgeModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} className="h-4 w-4" />
            高级（分别选择感知 / 评分模型）
          </label>
          <div className="space-y-2">
            <Label htmlFor="rubric">评分标准</Label>
            <textarea
              id="rubric"
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={3}
              placeholder="如：完整度 40 分、准确度 30 分、发音 20 分、流利度 10 分。"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {pendingCount > 0 ? (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => props.rows.filter((r) => r.status === 'UPLOADED' || r.status === 'FLAGGED').forEach((r) => grade(r.id))}
            >
              评阅全部未评（{pendingCount}）
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {props.classes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">按班级导出成绩</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {props.classes.map((c) => (
              <a key={c.id} href={`/dashboard/assignments/${props.assignmentId}/export?classId=${c.id}`}>
                <Button variant="outline" size="sm">{c.name} ↓ Excel</Button>
              </a>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {error ? <FormMessage>{error}</FormMessage> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">提交与评阅</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {props.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有学生提交。</p>
          ) : (
            props.rows.map((r) => (
              <div key={r.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.studentName} <span className="text-muted-foreground">{r.studentNo}</span></div>
                    <div className="text-xs text-muted-foreground">
                      {r.className} · {STATUS[r.status]}
                      {r.violations > 0 ? ` · ⚠️ ${r.violations} 次离开` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    {r.finalScore != null ? <div className="text-lg font-bold">{r.finalScore}</div> : <div className="text-muted-foreground">—</div>}
                    {r.aiScore != null ? <div className="text-xs text-muted-foreground">AI {r.aiScore}</div> : null}
                  </div>
                </div>
                {r.feedback ? <p className="mt-1 text-xs text-muted-foreground">{r.feedback}</p> : null}
                {r.recitedText ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">第一步 · 默写文本</summary>
                    <pre className="mt-1 whitespace-pre-wrap rounded bg-secondary p-2 font-sans">{r.recitedText}</pre>
                  </details>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" disabled={pending && busyId === r.id} onClick={() => grade(r.id)}>
                    {busyId === r.id && pending ? '评阅中…' : 'AI 评阅'}
                  </Button>
                  {r.hasVideo ? <Button size="sm" variant="outline" onClick={() => watch(r.id)}>看视频</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === r.id ? null : r.id)}>改分</Button>
                </div>
                {editing === r.id ? (
                  <OverrideForm row={r} disabled={pending} onSave={(score, fb) => saveOverride(r.id, score, fb)} />
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function OverrideForm({ row, disabled, onSave }: { row: Row; disabled: boolean; onSave: (score: string, feedback: string) => void }) {
  const [score, setScore] = useState(row.finalScore != null ? String(row.finalScore) : '')
  const [feedback, setFeedback] = useState(row.feedback)
  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={`score-${row.id}`} className="w-16">分数</Label>
        <Input id={`score-${row.id}`} value={score} onChange={(e) => setScore(e.target.value)} type="number" min={0} max={100} className="h-9 w-24" />
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        placeholder="评语（可选）"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button size="sm" disabled={disabled} onClick={() => onSave(score, feedback)}>保存分数</Button>
    </div>
  )
}
