'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Sparkles, ImageUp, ChevronUp, ChevronDown, ChevronRight, Trash2, Plus, Check } from 'lucide-react'
import { createAssignment, updateAssignment, deleteAssignment } from '@/actions/assignments'
import { draftAssignmentAction, type DraftFields } from '@/actions/authoring'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface PhaseInitial {
  id?: number // present when editing an existing phase; absent for a template prefill
  title: string
  category: string
  instructions: string
  useBankSet: boolean
  sentences: string
  openAt: string
  dueAt: string
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
  graded: boolean
  maxAttempts: number
  isFormalTest: boolean
  freePractice: boolean
}

export interface AssignmentInitial {
  id?: number // present when editing; absent when prefilling a new publish from a template
  title: string
  monthLabel: string
  chunkSetId: number | null
  chunkSetName: string | null
  chunkSetCount: number
  chunkSetHasVideo: boolean
  phases: PhaseInitial[]
}

const CATEGORY_PRESETS = ['背诵作业', '口语作业', '书面作业', '试卷作业', '听写作业', '默写作业']

// Open/due times round-trip through the browser, where the timezone is known. A
// `datetime-local` input is a *local* wall-clock; a UTC server would otherwise read
// it as UTC (e.g. 8h off in China). So we convert UTC ISO → local for display, and
// local → UTC ISO when serializing the phases for the server.
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function localToIso(local: string): string {
  if (!local) return ''
  const d = new Date(local)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}

// A phase as the form edits it (openAt/dueAt are local-wall-clock strings).
interface PhaseState {
  id?: number // existing phase id (edit) so the server reconciles in place, not delete+recreate
  title: string
  category: string
  instructions: string
  useBankSet: boolean
  sentences: string
  openAt: string
  dueAt: string
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
  graded: boolean
  maxAttempts: number
  isFormalTest: boolean
  freePractice: boolean
}

// A fresh phase. `bank` = there's a published set this phase can draw from. `recite`
// shapes it as an eyes-closed recitation rather than the default shadowing/video.
function newPhase(bank: boolean, recite = false): PhaseState {
  return {
    title: '',
    category: '',
    instructions: '',
    useBankSet: bank,
    sentences: '',
    openAt: '',
    dueAt: '',
    requireEyesClosed: bank ? recite : true,
    requireText: false,
    requireAudio: bank && !recite,
    requireVideo: bank ? recite : true,
    requireHandwriting: false,
    graded: true,
    maxAttempts: 3,
    isFormalTest: false,
    freePractice: false,
  }
}

export interface PublishTarget {
  offeringId: number
  label: string
}

export function AssignmentForm({
  offeringId,
  targets,
  initial,
  chunkSet,
}: {
  offeringId?: number
  targets?: PublishTarget[]
  initial?: AssignmentInitial
  chunkSet?: { id: number; name: string; count: number; hasVideo: boolean }
}) {
  const t = useT()
  // `initial` with an id = editing an existing assignment; `initial` without an id =
  // prefilling a NEW publish from a template (still create mode).
  const editing = Boolean(initial?.id)
  // The published bank set this assignment draws from (publish flow, or editing a
  // bank-published assignment): its phases can pull sentences + shadow video from it.
  const bankInfo = chunkSet ?? (initial?.chunkSetId ? { id: initial.chunkSetId, name: initial.chunkSetName ?? '', count: initial.chunkSetCount, hasVideo: initial.chunkSetHasVideo } : null)
  const hasBank = Boolean(bankInfo)
  const [state, action, isPending] = useActionState(editing ? updateAssignment : createAssignment, null)

  // Assignment-level fields (controlled so the AI draft can fill them).
  const [title, setTitle] = useState(initial?.title ?? '')
  // Save-as-template (publish flow only).
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const [phases, setPhases] = useState<PhaseState[]>(() =>
    initial?.phases?.length
      ? initial.phases.map((p) => ({ ...p, openAt: p.openAt ? toLocalInput(p.openAt) : '', dueAt: p.dueAt ? toLocalInput(p.dueAt) : '' }))
      : [newPhase(hasBank)],
  )
  // Phases are an accordion — only one expanded at a time so a multi-phase form isn't
  // a wall of inputs. -1 = all collapsed.
  const [openPhase, setOpenPhase] = useState(0)

  function patchPhase(i: number, patch: Partial<PhaseState>) {
    setPhases((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }
  function addPhase() {
    // Offer the natural second step for a bank set: an eyes-closed recitation.
    setPhases((prev) => [...prev, newPhase(hasBank, hasBank && prev.length === 1)])
    setOpenPhase(phases.length) // expand the newly added phase
  }
  function removePhase(i: number) {
    setPhases((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
    setOpenPhase((o) => (o >= i ? Math.max(0, o - 1) : o))
  }
  function movePhase(i: number, dir: -1 | 1) {
    setPhases((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function applyDraft(d: DraftFields) {
    if (d.title) setTitle(d.title)
    // The AI draft's type/instructions/sentences fill the first phase (category is per-phase now).
    if (d.category || d.instructions || d.sentences) {
      patchPhase(0, {
        ...(d.category ? { category: d.category } : {}),
        ...(d.instructions ? { instructions: d.instructions } : {}),
        ...(d.sentences ? { sentences: d.sentences } : {}),
      })
    }
  }

  // Serialize phases for the server (local times → UTC ISO).
  const phasesJson = JSON.stringify(
    phases.map((p) => ({
      ...(p.id ? { id: p.id } : {}),
      title: p.title,
      category: p.category,
      instructions: p.instructions,
      useBankSet: hasBank && p.useBankSet,
      sentences: hasBank && p.useBankSet ? '' : p.sentences,
      openAt: localToIso(p.openAt),
      dueAt: localToIso(p.dueAt),
      requireEyesClosed: p.requireEyesClosed,
      requireText: p.requireText,
      requireAudio: p.requireAudio,
      requireVideo: p.requireVideo,
      requireHandwriting: p.requireHandwriting,
      graded: p.graded,
      maxAttempts: p.maxAttempts,
      isFormalTest: p.isFormalTest,
      freePractice: p.freePractice,
    })),
  )

  const multi = !editing && (targets?.length ?? 0) > 1
  const singleOfferingId = offeringId ?? targets?.[0]?.offeringId
  const [selected, setSelected] = useState<Set<number>>(() => new Set(offeringId != null ? [offeringId] : []))
  const allSelected = (targets?.length ?? 0) > 0 && selected.size === targets!.length
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Publishing is a 3-step wizard (basic → phases → review) to cut the single-screen
  // cognitive load; editing keeps the single scroll.
  const wizard = !editing
  const [step, setStep] = useState(0)
  const STEP_KEYS = ['asg.stepBasic', 'asg.stepPhases', 'asg.stepReview']

  // The month list + default — computed in an effect (not during render) so a UTC
  // server and the teacher's local-TZ browser can't disagree at hydration.
  const [monthOptions, setMonthOptions] = useState<string[]>([])
  const [month, setMonth] = useState('')
  useEffect(() => {
    const base = new Date()
    const cur = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
    const out: string[] = []
    const d = new Date(base); d.setDate(1); d.setMonth(d.getMonth() - 1)
    for (let i = 0; i < 13; i++) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      d.setMonth(d.getMonth() + 1)
    }
    const label = initial?.monthLabel
    setMonthOptions(label && !out.includes(label) ? [label, ...out] : out)
    setMonth(label ?? cur)
  }, [initial?.monthLabel])

  return (
    <div className="space-y-4">
      {!editing && !hasBank && step === 0 ? <AiDraftPanel onApply={applyDraft} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{editing ? t('asg.editTitle') : t('asg.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            {editing ? <input type="hidden" name="assignmentId" value={initial!.id ?? ""} /> : <input type="hidden" name="primaryOfferingId" value={singleOfferingId ?? ''} />}
            {!editing && !multi ? <input type="hidden" name="offeringId" value={singleOfferingId ?? ''} /> : null}
            {bankInfo ? <input type="hidden" name="chunkSetId" value={bankInfo.id} /> : null}
            <input type="hidden" name="phasesJson" value={phasesJson} />
            <datalist id="category-presets">
              {CATEGORY_PRESETS.map((c) => <option key={c} value={c} />)}
            </datalist>

            {wizard ? (
              <div className="flex items-center gap-1.5">
                {STEP_KEYS.map((key, i) => (
                  <div key={key} className="flex flex-1 items-center gap-1.5">
                    <div className={'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ' + (i < step ? 'bg-success text-white' : i === step ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
                      {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </div>
                    <span className={'truncate text-xs font-medium ' + (i === step ? 'text-foreground' : 'text-muted-foreground')}>{t(key)}</span>
                    {i < STEP_KEYS.length - 1 ? <div className={'h-0.5 flex-1 rounded ' + (i < step ? 'bg-success' : 'bg-border')} /> : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className={wizard && step !== 0 ? 'hidden' : 'space-y-4'}>
            {multi ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{t('asg.publishTo')}</Label>
                  <button
                    type="button"
                    onClick={() => setSelected(allSelected ? new Set() : new Set(targets!.map((tg) => tg.offeringId)))}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {allSelected ? t('asg.deselectAll') : t('asg.selectAll')}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t('asg.publishToHint')}</p>
                <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto">
                  {targets!.map((tg) => (
                    <label
                      key={tg.offeringId}
                      className="tap flex cursor-pointer items-center gap-2 rounded-xl border border-input bg-background px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground"
                    >
                      <input
                        type="checkbox"
                        name="offeringId"
                        value={tg.offeringId}
                        checked={selected.has(tg.offeringId)}
                        onChange={() => toggleOne(tg.offeringId)}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="truncate">{tg.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 作业类型（category）现按环节设置，见下方各环节卡片。 */}
            <div className="space-y-1.5">
              <Label htmlFor="title">{t('asg.fTitle')}</Label>
              <Input id="title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monthLabel">{t('asg.fMonth')}</Label>
              <select id="monthLabel" name="monthLabel" value={month} onChange={(e) => setMonth(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="">{t('asg.monthNone')}</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            </div>

            <div className={wizard && step !== 1 ? 'hidden' : 'space-y-3'}>
              <div className="flex items-center justify-between">
                <Label>{t('asg.phases')}</Label>
                <span className="text-xs text-muted-foreground">{phases.length} {t('asg.phaseUnit')}</span>
              </div>
              {phases.length > 1 ? <p className="text-xs text-muted-foreground">{t('asg.phasesPreviewHint')}</p> : null}
              {phases.map((p, i) => (
                <PhaseCard
                  key={i}
                  index={i}
                  total={phases.length}
                  phase={p}
                  bank={bankInfo}
                  open={openPhase === i}
                  onToggle={() => setOpenPhase(openPhase === i ? -1 : i)}
                  onPatch={(patch) => patchPhase(i, patch)}
                  onMove={(dir) => movePhase(i, dir)}
                  onRemove={() => removePhase(i)}
                />
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={addPhase}>
                <Plus className="h-4 w-4" />{t('asg.addPhase')}
              </Button>
            </div>

            <div className={wizard && step !== 2 ? 'hidden' : 'space-y-4'}>
              {!editing ? (
                <div className="space-y-2 rounded-xl border border-input p-3">
                  <label className="flex items-center gap-2.5 text-sm">
                    <input type="checkbox" name="saveTemplate" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} className="h-4 w-4 accent-primary" />
                    {t('tmpl.saveAs')}
                  </label>
                  {saveTemplate ? (
                    <Input name="templateName" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={t('tmpl.namePh')} maxLength={100} />
                  ) : null}
                  <p className="text-xs text-muted-foreground">{t('tmpl.saveHint')}</p>
                </div>
              ) : null}
              {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
            </div>

            {/* Wizard nav (publish flow): Back / Next; the publish button only on the last step */}
            <div className="flex gap-3">
              {wizard && step > 0 ? (
                <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => setStep((s) => Math.max(0, s - 1))}>{t('asg.back')}</Button>
              ) : null}
              {wizard && step < 2 ? (
                <Button type="button" size="lg" className="flex-1" onClick={() => setStep((s) => Math.min(2, s + 1))}>{t('asg.next')}</Button>
              ) : (
                <Button type="submit" disabled={isPending} size="lg" className="flex-1">
                  {isPending ? (editing ? t('asg.saving') : t('asg.publishing')) : editing ? t('asg.save') : t('asg.publish')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {editing ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4">
            <form action={deleteAssignment} onSubmit={(e) => { if (!confirm(t('asg.deleteConfirm'))) e.preventDefault() }}>
              <input type="hidden" name="assignmentId" value={initial!.id ?? ""} />
              <SubmitButton variant="destructive" className="w-full">{t('asg.delete')}</SubmitButton>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function PhaseCard({
  index,
  total,
  phase,
  bank,
  open,
  onToggle,
  onPatch,
  onMove,
  onRemove,
}: {
  index: number
  total: number
  phase: PhaseState
  bank: { id: number; name: string; count: number; hasVideo: boolean } | null
  open: boolean
  onToggle: () => void
  onPatch: (patch: Partial<PhaseState>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const t = useT()
  // One-line summary shown when the phase is collapsed.
  const kinds = [
    phase.requireVideo && t('asg.kindVideo'),
    phase.requireAudio && t('asg.kindAudio'),
    phase.requireText && t('asg.kindText'),
    phase.requireHandwriting && t('asg.kindHandwriting'),
  ].filter(Boolean).join(' / ')
  const summary = [phase.title.trim() || phase.category.trim(), kinds].filter(Boolean).join(' · ')
  return (
    <div className="rounded-xl border border-input p-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onToggle} className="tap flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="shrink-0">{t('asg.phase')} {index + 1}</span>
          {!open && summary ? <span className="truncate text-xs font-normal text-muted-foreground">· {summary}</span> : null}
        </button>
        <div className="flex items-center gap-1">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="tap rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label={t('asg.moveUp')}>
            <ChevronUp className="h-4 w-4" />
          </button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="tap rounded-lg p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label={t('asg.moveDown')}>
            <ChevronDown className="h-4 w-4" />
          </button>
          <button type="button" disabled={total <= 1} onClick={onRemove} className="tap rounded-lg p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30" aria-label={t('asg.removePhase')}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={open ? 'mt-3 space-y-3' : 'hidden'}>
      <Input value={phase.title} onChange={(e) => onPatch({ title: e.target.value })} placeholder={t('asg.phaseTitlePh')} />

      <div className="space-y-1.5">
        <Label>{t('asg.fCategory')}</Label>
        <Input list="category-presets" value={phase.category} onChange={(e) => onPatch({ category: e.target.value })} placeholder={t('asg.fCategoryPh')} />
      </div>

      {/* Content source */}
      {bank ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={phase.useBankSet} onChange={(e) => onPatch({ useBankSet: e.target.checked })} className="h-4 w-4 accent-primary" />
            {t('asg.useBankSet')}
          </label>
          {phase.useBankSet ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              <div className="font-medium">{t('asg.fromBank')}：{bank.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {bank.count} {t('bank.chunkUnit')} · {bank.hasVideo ? t('bank.hasVideo') : t('bank.noVideo')}
              </div>
            </div>
          ) : (
            <Textarea rows={5} value={phase.sentences} onChange={(e) => onPatch({ sentences: e.target.value })} placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'} />
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>{t('asg.fSentences')}</Label>
          <Textarea rows={5} value={phase.sentences} onChange={(e) => onPatch({ sentences: e.target.value })} placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'} />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t('asg.fInstructions')}</Label>
        <Textarea rows={2} value={phase.instructions} onChange={(e) => onPatch({ instructions: e.target.value })} placeholder={t('asg.fInstructionsPh')} />
      </div>

      {/* Submission requirements */}
      <div className="space-y-2">
        <Label>{t('asg.submitKinds')}</Label>
        <div className="space-y-2.5 rounded-xl border border-input p-3 text-sm">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireVideo} onChange={(e) => onPatch({ requireVideo: e.target.checked })} className="h-4 w-4 accent-primary" />
            {t('asg.kindVideo')}
          </label>
          <label className="flex items-center gap-2.5 pl-6 text-muted-foreground">
            <input type="checkbox" checked={phase.requireEyesClosed} onChange={(e) => onPatch({ requireEyesClosed: e.target.checked })} className="h-4 w-4 accent-primary" />
            {t('asg.fEyes')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireAudio} onChange={(e) => onPatch({ requireAudio: e.target.checked })} className="h-4 w-4 accent-primary" />
            {t('asg.kindAudio')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireText} onChange={(e) => onPatch({ requireText: e.target.checked })} className="h-4 w-4 accent-primary" />
            {t('asg.kindText')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireHandwriting} onChange={(e) => onPatch({ requireHandwriting: e.target.checked })} className="h-4 w-4 accent-primary" />
            {t('asg.kindHandwriting')}
          </label>
        </div>
      </div>

      {/* Time window + attempts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t('asg.fOpenAt')}</Label>
          <Input type="datetime-local" value={phase.openAt} onChange={(e) => onPatch({ openAt: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('asg.fDueAt')}</Label>
          <Input type="datetime-local" value={phase.dueAt} onChange={(e) => onPatch({ dueAt: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t('asg.fAttempts')}</Label>
          <Input type="number" min={1} value={phase.maxAttempts} onChange={(e) => onPatch({ maxAttempts: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
        <label className="flex items-end gap-2.5 pb-2.5 text-sm">
          <input type="checkbox" checked={phase.graded} onChange={(e) => onPatch({ graded: e.target.checked })} className="h-4 w-4 accent-primary" />
          <span>{t('asg.graded')}<span className="block text-xs text-muted-foreground">{t('asg.gradedHint')}</span></span>
        </label>
      </div>

      {/* 自由练习（仅「不计分」时可选）：不限次数、不进待批 */}
      {!phase.graded ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-input p-3 text-sm">
          <input type="checkbox" checked={phase.freePractice} onChange={(e) => onPatch({ freePractice: e.target.checked })} className="mt-0.5 h-4 w-4 accent-primary" />
          <span>{t('asg.freePractice')}<span className="block text-xs text-muted-foreground">{t('asg.freePracticeHint')}</span></span>
        </label>
      ) : null}

      {/* 正式测试·强防作弊分层 */}
      <label className="flex items-start gap-2.5 rounded-xl border border-input p-3 text-sm">
        <input type="checkbox" checked={phase.isFormalTest} onChange={(e) => onPatch({ isFormalTest: e.target.checked })} className="mt-0.5 h-4 w-4 accent-primary" />
        <span>{t('asg.formalTest')}<span className="block text-xs text-muted-foreground">{t('asg.formalTestHint')}</span></span>
      </label>
      </div>
    </div>
  )
}

// AI 备课出题：老师给主题/课文，或拍张课本照片，AI 起草整份作业，回填到表单。
function AiDraftPanel({ onApply }: { onApply: (d: DraftFields) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function generate() {
    setBusy(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.set('topic', topic)
      if (file) fd.set('image', file)
      const res = await draftAssignmentAction(fd)
      if (res.status === 'ok') { onApply(res.draft); setMsg(t('author.applied')) }
      else if (res.status === 'unavailable') setMsg(t('author.unavailable'))
      else setMsg(res.message)
    } catch {
      setMsg(t('author.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Card
        className="tap border-primary/30 bg-primary/5 hover:shadow-card"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
      >
        <CardContent className="flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug">{t('author.cardTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('author.cardDesc')}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold">{t('author.cardTitle')}</span>
        </div>
        <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} placeholder={t('author.topicPh')} />
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <ImageUp className="h-4 w-4" />{file ? t('author.photoChosen') : t('author.addPhoto')}
          </Button>
          {file ? <button type="button" onClick={() => setFile(null)} className="text-xs text-muted-foreground hover:text-foreground">{t('author.removePhoto')}</button> : null}
        </div>
        {msg ? <FormMessage>{msg}</FormMessage> : null}
        <div className="flex gap-2">
          <Button type="button" disabled={busy || (!topic.trim() && !file)} onClick={generate}>
            <Sparkles className="h-4 w-4" />{busy ? t('author.generating') : t('author.generate')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('author.collapse')}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('author.tip')}</p>
      </CardContent>
    </Card>
  )
}
