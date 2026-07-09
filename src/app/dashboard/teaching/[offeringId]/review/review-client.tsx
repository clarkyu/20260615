'use client'

// 学期总评工作台(客户端):比例滑杆即时重算(与服务端同一纯函数,口径不分叉)、
// 逐格改分/免计、保存配置(乐观锁)。发布/AI 推荐在后续 PR 接到本页。
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/components/i18n-provider'
import {
  categoryAuto,
  computeTotal,
  effectiveCategories,
  validateReviewConfig,
  type ReviewCategoryKey,
  type ReviewConfig,
} from '@/lib/domain/review'
import type { WorkbenchStudent } from '@/lib/domain/review-load'
import { clearReviewOverride, saveReviewConfig, setReviewOverride } from '@/actions/review'

const CATS: ReviewCategoryKey[] = ['classroom', 'training', 'final']

export function ReviewWorkbench(props: {
  offeringId: number
  config: ReviewConfig
  configVersion: number
  students: WorkbenchStudent[]
  assignments: { id: number; title: string }[]
  classPerf: { fileName: string; sessions: number } | null
}) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [config, setConfig] = useState<ReviewConfig>(props.config)
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ studentId: number; cat: ReviewCategoryKey } | null>(null)
  const [editScore, setEditScore] = useState('')
  const [editReason, setEditReason] = useState('')

  const dirty = JSON.stringify(config.weights) !== JSON.stringify(props.config.weights) ||
    JSON.stringify(config.categories.training.assignmentWeights) !== JSON.stringify(props.config.categories.training.assignmentWeights)
  const weightErr = validateReviewConfig(config)
  const weightSum = config.weights.classroom + config.weights.training + config.weights.final

  // 行计算:与发布/学生页同一函数族(domain/review 纯函数),滑杆改动即时反映。
  const rows = useMemo(
    () =>
      props.students.map((s) => {
        const auto = categoryAuto(s.inputs, config)
        const cats = effectiveCategories(auto, s.overrides)
        return { s, auto, cats, total: computeTotal(cats, config.weights) }
      }),
    [props.students, config],
  )

  const setWeight = (key: ReviewCategoryKey, value: number) =>
    setConfig((c) => ({ ...c, weights: { ...c.weights, [key]: value } }))
  const setTrainingWeight = (i: number, value: number) =>
    setConfig((c) => {
      const w = [...c.categories.training.assignmentWeights]
      w[i] = value
      return { ...c, categories: { ...c.categories, training: { ...c.categories.training, assignmentWeights: w } } }
    })

  const onSave = () =>
    startTransition(async () => {
      const res = await saveReviewConfig(props.offeringId, config, props.configVersion)
      setMsg(res.error ?? t('review.saved'))
      if (!res.error) router.refresh()
    })

  const openEdit = (studentId: number, cat: ReviewCategoryKey, current: number | null) => {
    setEditing({ studentId, cat })
    setEditScore(current == null ? '' : String(current))
    setEditReason('')
  }
  const submitOverride = (state: 'OVERRIDE' | 'EXEMPT') =>
    startTransition(async () => {
      if (!editing) return
      const score = state === 'EXEMPT' ? null : Number(editScore)
      const res = await setReviewOverride(props.offeringId, editing.studentId, editing.cat, score, state, editReason)
      setMsg(res.error ?? t('review.saved'))
      if (!res.error) {
        setEditing(null)
        router.refresh()
      }
    })
  const submitClear = () =>
    startTransition(async () => {
      if (!editing) return
      const res = await clearReviewOverride(props.offeringId, editing.studentId, editing.cat)
      setMsg(res.error ?? t('review.saved'))
      if (!res.error) {
        setEditing(null)
        router.refresh()
      }
    })

  const catLabel: Record<ReviewCategoryKey, string> = {
    classroom: t('review.classroom'),
    training: t('review.training'),
    final: t('review.final'),
  }

  return (
    <div className="space-y-4">
      {/* 比例配置 */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-4">
            {CATS.map((key) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{catLabel[key]} %</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={config.weights[key]}
                  onChange={(e) => setWeight(key, Number(e.target.value))}
                  className="w-24 tabular-nums"
                  aria-label={`${catLabel[key]} %`}
                />
              </label>
            ))}
            <div className={`text-sm ${weightSum === 100 ? 'text-muted-foreground' : 'font-semibold text-destructive'}`} aria-live="polite">
              {t('review.weightSum')}: {weightSum}
            </div>
            <Button size="sm" onClick={onSave} disabled={pending || !!weightErr || !dirty}>
              {t('review.save')}
            </Button>
            {dirty && <Badge tone="warning">{t('review.unsaved')}</Badge>}
          </div>
          {config.categories.training.assignmentIds.length > 1 && (
            <div className="flex flex-wrap items-end gap-4 border-t pt-3">
              <span className="text-xs text-muted-foreground">{t('review.trainingInner')}</span>
              {config.categories.training.assignmentIds.map((aid, i) => (
                <label key={aid} className="flex flex-col gap-1 text-xs">
                  <span className="max-w-40 truncate text-muted-foreground" title={props.assignments.find((a) => a.id === aid)?.title}>
                    {props.assignments.find((a) => a.id === aid)?.title ?? `#${aid}`}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={config.categories.training.assignmentWeights[i] ?? 0}
                    onChange={(e) => setTrainingWeight(i, Number(e.target.value))}
                    className="w-20 tabular-nums"
                    aria-label={`${t('review.trainingInner')} ${i + 1}`}
                  />
                </label>
              ))}
            </div>
          )}
          {weightErr && <p className="text-sm text-destructive">{t(weightErr)}</p>}
          {!props.classPerf && <p className="text-xs text-muted-foreground">{t('review.noClassPerf')}</p>}
          <p className="text-xs text-muted-foreground">{t('review.missingZeroNote')}</p>
          {msg && (
            <p className="text-sm" aria-live="polite">
              {msg}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 总表 */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2">{t('review.student')}</th>
                {CATS.map((key) => (
                  <th key={key} scope="col" className="px-3 py-2">{catLabel[key]}</th>
                ))}
                <th scope="col" className="px-3 py-2">{t('review.total')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, cats, total }) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <span className="tabular-nums text-muted-foreground">{s.no}</span> {s.name}
                  </td>
                  {CATS.map((key) => {
                    const c = cats[key]
                    return (
                      <td key={key} className="px-3 py-2">
                        <button
                          type="button"
                          className="tap rounded px-1 tabular-nums hover:bg-muted"
                          onClick={() => openEdit(s.id, key, c.fin)}
                          aria-label={`${s.name ?? s.no} ${catLabel[key]}`}
                        >
                          {c.exempt ? (
                            <Badge tone="warning">{t('review.exempted')}</Badge>
                          ) : c.fin == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <>
                              {c.fin.toFixed(1)}
                              {c.override != null && (
                                <Badge className="ml-1">{t('review.overrideBadge')}</Badge>
                              )}
                            </>
                          )}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 font-semibold tabular-nums">{total == null ? '—' : total.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 逐格编辑面板 */}
      {editing && (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="text-sm">
              {props.students.find((x) => x.id === editing.studentId)?.name} · {catLabel[editing.cat]}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t('review.override')}</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={editScore}
                onChange={(e) => setEditScore(e.target.value)}
                className="w-24 tabular-nums"
                aria-label={t('review.override')}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t('review.reason')}</span>
              <Input value={editReason} onChange={(e) => setEditReason(e.target.value)} className="w-56" aria-label={t('review.reason')} />
            </label>
            <Button size="sm" onClick={() => submitOverride('OVERRIDE')} disabled={pending || editScore === ''}>
              {t('review.override')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => submitOverride('EXEMPT')} disabled={pending}>
              {t('review.exempt')}
            </Button>
            <Button size="sm" variant="ghost" onClick={submitClear} disabled={pending}>
              {t('review.restore')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              {t('confirm.cancel')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
