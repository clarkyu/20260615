'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Sparkles, ImageUp, ChevronUp, ChevronDown, ChevronRight, Trash2, Plus, Check, Video, Eye, Mic, PenLine, Camera } from 'lucide-react'
import { createAssignment, updateAssignment, deleteAssignment } from '@/actions/assignments'
import { draftAssignmentAction, type DraftFields } from '@/actions/authoring'
import { ASSIGNMENT_MODES } from '@/lib/assignment-mode'
import { modelsForCapability } from '@/lib/ai/registry'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useConfirm, confirmSubmit } from '@/components/ui/confirm'
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
  requireChoice: boolean
  choices: string[]
  // 单选题正确答案的下标（-1 = 无正确答案，纯投票）。落库时映射成选项文本 correctChoice。
  correctIndex: number
  // 多选题：multiChoice=true → 学生可多选；correctIndices 是正确选项的下标集合
  // （空 = 多选投票）。落库时映射成选项文本 JSON 数组 correctChoices。
  multiChoice: boolean
  correctIndices: number[]
  // 选题模式（仅当纯选择、无正确答案时有意义）：'poll'=课堂民调（默认，= 历史纯投票）；'theme'=选题·主题。'branch' 留待 P2。
  selectionMode: 'poll' | 'theme' | null
  // 填空题：fillText 是带 ____ 挖空标记的题干；fillAccept 是每个空的可接受答案
  // （编辑时用「|」分隔多个），空数 = fillText 里的 ____ 个数。落库成 blanksJson。
  fillBlank: boolean
  fillText: string
  fillAccept: string[]
  requireFreeText: boolean
  // 每环节单独的批阅配置（可选，空=跟随作业/平台默认）：评分标准 + 感知/评分模型。
  rubric: string
  perceptionModel: string
  judgeModel: string
  graded: boolean
  maxAttempts: number
  // 该环节在作业总分里的相对权重（≥1），默认 1 = 等权。
  weight: number
  isFormalTest: boolean
  freePractice: boolean
  // 该环节现有的（非草稿）学生提交数——仅编辑已发布作业时由服务端带入；删除有提交的
  // 环节会连带删除这些提交，故删除前二次确认。新建/新环节为 0。
  submissionCount?: number
}

export interface AssignmentInitial {
  id?: number // present when editing; absent when prefilling a new publish from a template
  version?: number // optimistic-lock token loaded with the assignment (edit mode)
  title: string
  mode?: string // 作业性质四态(HOMEWORK/…),'' = 未设置
  monthLabel: string
  chunkSetId: number | null
  chunkSetName: string | null
  chunkSetCount: number
  chunkSetHasVideo: boolean
  phases: PhaseInitial[]
}

const CATEGORY_PRESETS = ['背诵作业', '口语作业', '书面作业', '试卷作业', '听写作业', '默写作业']

// 评分模型可选项（纯静态目录，客户端直接读 registry）。空选项 = 跟随作业/平台默认。
const PERCEPTION_MODELS = modelsForCapability('perception').map((m) => ({ id: m.id, label: m.label }))
const JUDGE_MODELS = modelsForCapability('judge').map((m) => ({ id: m.id, label: m.label }))
// AI 出题（备课）可选模型。空选项 = 默认（文字用 DeepSeek，拍照自动切 Gemini）。
const AUTHOR_MODELS = modelsForCapability('author').map((m) => ({ id: m.id, label: m.label }))

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
  // Stable client-only key so React — and the DOM state it holds (<details> open, focus) —
  // follows a phase across reorder instead of sticking to its slot. Never sent to the server.
  uid: string
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
  requireChoice: boolean
  choices: string[]
  // 单选题正确答案的下标（-1 = 无正确答案，纯投票）。落库时映射成选项文本 correctChoice。
  correctIndex: number
  // 多选题：multiChoice=true → 学生可多选；correctIndices 是正确选项的下标集合
  // （空 = 多选投票）。落库时映射成选项文本 JSON 数组 correctChoices。
  multiChoice: boolean
  correctIndices: number[]
  // 选题模式（仅当纯选择、无正确答案时有意义）：'poll'=课堂民调（默认，= 历史纯投票）；'theme'=选题·主题。'branch' 留待 P2。
  selectionMode: 'poll' | 'theme' | null
  // 填空题：fillText 是带 ____ 挖空标记的题干；fillAccept 是每个空的可接受答案
  // （编辑时用「|」分隔多个），空数 = fillText 里的 ____ 个数。落库成 blanksJson。
  fillBlank: boolean
  fillText: string
  fillAccept: string[]
  requireFreeText: boolean
  // 每环节单独的批阅配置（可选，空=跟随作业/平台默认）：评分标准 + 感知/评分模型。
  rubric: string
  perceptionModel: string
  judgeModel: string
  graded: boolean
  maxAttempts: number
  // 该环节在作业总分里的相对权重（≥1），默认 1 = 等权。
  weight: number
  isFormalTest: boolean
  freePractice: boolean
  // 该环节现有的（非草稿）学生提交数——仅编辑已发布作业时由服务端带入；删除有提交的
  // 环节会连带删除这些提交，故删除前二次确认。新建/新环节为 0。
  submissionCount?: number
}

// A fresh phase. `bank` = there's a published set this phase can draw from. `recite`
// shapes it as an eyes-closed recitation rather than the default shadowing/video.
function newPhase(bank: boolean, recite = false): PhaseState {
  return {
    uid: crypto.randomUUID(),
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
    requireChoice: false,
    choices: [],
    correctIndex: -1,
    multiChoice: false,
    correctIndices: [],
    selectionMode: null,
    fillBlank: false,
    fillText: '',
    fillAccept: [],
    requireFreeText: false,
    rubric: '',
    perceptionModel: '',
    judgeModel: '',
    graded: true,
    maxAttempts: 3,
    weight: 1,
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
  const confirm = useConfirm()
  // `initial` with an id = editing an existing assignment; `initial` without an id =
  // prefilling a NEW publish from a template (still create mode).
  const editing = Boolean(initial?.id)
  // The phase ids this form LOADED (stable across the teacher's edits). Submitted so the
  // server deletes only phases that were loaded-then-dropped — never a phase added
  // concurrently after load, whose submissions a stale save would otherwise destroy (P2-9).
  const knownPhaseIds = (initial?.phases ?? []).map((p) => p.id).filter((x): x is number => typeof x === 'number')
  // The published bank set this assignment draws from (publish flow, or editing a
  // bank-published assignment): its phases can pull sentences + shadow video from it.
  const bankInfo = chunkSet ?? (initial?.chunkSetId ? { id: initial.chunkSetId, name: initial.chunkSetName ?? '', count: initial.chunkSetCount, hasVideo: initial.chunkSetHasVideo } : null)
  const hasBank = Boolean(bankInfo)
  const [state, action, isPending] = useActionState(editing ? updateAssignment : createAssignment, null)

  // Idempotency key for publishing: one stable id per publish-form instance, so a
  // double-clicked / retried submit can't create duplicate assignments. Generated after
  // mount (client-only) to avoid an SSR/client hydration mismatch.
  const [publishBatchId, setPublishBatchId] = useState('')
  useEffect(() => { if (!editing) setPublishBatchId(crypto.randomUUID()) }, [editing])

  // Assignment-level fields (controlled so the AI draft can fill them).
  const [title, setTitle] = useState(initial?.title ?? '')
  // 作业性质四态('' = 未设置),显示为列表批次卡的分类标签。
  const [mode, setMode] = useState(initial?.mode ?? '')
  // Save-as-template (publish flow only).
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  // Seed with EMPTY open/due times so SSR and the client render identically; the loaded ISO is
  // converted to the teacher's local wall-clock AFTER mount (below), mirroring the month handling.
  // `toLocalInput` is TZ-dependent, so doing it in the initializer made a UTC server and a local-TZ
  // browser disagree at hydration on every edit of an assignment with times (audit A5).
  const [phases, setPhases] = useState<PhaseState[]>(() =>
    initial?.phases?.length
      ? initial.phases.map((p) => ({ ...p, uid: crypto.randomUUID(), openAt: '', dueAt: '' }))
      : [newPhase(hasBank)],
  )
  useEffect(() => {
    if (!initial?.phases?.length) return
    setPhases((cur) => cur.map((p, i) => {
      const src = initial.phases![i]
      return src ? { ...p, openAt: src.openAt ? toLocalInput(src.openAt) : '', dueAt: src.dueAt ? toLocalInput(src.dueAt) : '' } : p
    }))
    // Mount-only: fill the loaded phase times once, client-side. `initial` is a stable prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
  async function removePhase(i: number) {
    if (phases.length <= 1) return
    // 删除一个已有（非草稿）提交的环节会连带删除这些提交（外键级联）——删除前二次确认。
    const n = phases[i]?.submissionCount ?? 0
    if (n > 0 && !(await confirm({ body: t('asg.removePhaseConfirm', { n }), danger: true, okLabel: t('asg.removePhase') }))) return
    setPhases((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
    setOpenPhase((o) => (o >= i ? Math.max(0, o - 1) : o))
  }
  function movePhase(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= phases.length) return
    setPhases((prev) => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    // The accordion open state is tracked by index — swap it too so the phase the teacher
    // moved stays the expanded one (not whichever phase slid into the old open slot).
    setOpenPhase((o) => (o === i ? j : o === j ? i : o))
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
      requireChoice: p.requireChoice,
      choicesJson: p.requireChoice ? JSON.stringify(p.choices.map((c) => c.trim()).filter(Boolean)) : null,
      // 正确答案存「选项文本」（与学生作答 recitedText 同形，便于判分）；-1 或空选项 → 仅投票。
      // 单选走 correctChoice；多选走 correctChoices（选项文本 JSON 数组），两者互斥不串。
      correctChoice: p.requireChoice && !p.multiChoice && p.correctIndex >= 0 ? (p.choices[p.correctIndex]?.trim() || null) : null,
      multiChoice: p.requireChoice && p.multiChoice,
      correctChoices: p.requireChoice && p.multiChoice && p.correctIndices.length > 0
        ? JSON.stringify(p.correctIndices.map((i) => p.choices[i]?.trim()).filter(Boolean))
        : null,
      // 选题模式只在「纯选择、无答案键」时有意义：设了答案键(客观判分题)或非选择环节一律 null。
      selectionMode: p.requireChoice && !(p.multiChoice ? p.correctIndices.length > 0 : p.correctIndex >= 0) ? p.selectionMode : null,
      fillBlank: p.fillBlank,
      // blanksJson = { text, accept }；accept 长度按题干 ____ 个数取（= 总空数），
      // 每空的可接受答案由「|」分隔。空数为准，多余/缺失的 fillAccept 自动对齐。
      blanksJson: p.fillBlank
        ? JSON.stringify({
            text: p.fillText,
            accept: Array.from({ length: (p.fillText.match(/_{3,}/g) ?? []).length }, (_, i) =>
              (p.fillAccept[i] ?? '').split('|').map((x) => x.trim()).filter(Boolean),
            ),
          })
        : null,
      requireFreeText: p.requireFreeText,
      rubric: p.rubric.trim() || null,
      perceptionModel: p.perceptionModel || null,
      judgeModel: p.judgeModel || null,
      graded: p.graded,
      maxAttempts: p.maxAttempts,
      weight: p.weight,
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

  // 确认步「发布前小结」用：把每个环节的提交类型拼成一句话；勾选的发布目标班级。
  const kindsOf = (p: PhaseState) =>
    [
      p.requireVideo && t('asg.kindVideo'),
      p.requireAudio && t('asg.kindAudio'),
      p.requireText && t('asg.kindText'),
      p.requireHandwriting && t('asg.kindHandwriting'),
      p.requireChoice && t('asg.kindChoice'),
      p.requireFreeText && t('asg.kindFreeText'),
      p.fillBlank && t('asg.kindFillBlank'),
    ].filter(Boolean).join(' / ')
  const targetLabels = (targets ?? []).filter((tg) => selected.has(tg.offeringId)).map((tg) => tg.label)

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
            {editing ? <input type="hidden" name="knownPhaseIds" value={knownPhaseIds.join(',')} /> : null}
            {editing ? <input type="hidden" name="version" value={initial?.version ?? 0} /> : null}
            {!editing ? <input type="hidden" name="batchId" value={publishBatchId} /> : null}
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
              <Label htmlFor="mode">{t('asg.fMode')}</Label>
              <Select id="mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">{t('asg.fModeNone')}</option>
                {ASSIGNMENT_MODES.map((m) => (
                  <option key={m} value={m}>{t(`mode.${m}`)}</option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{t('asg.fModeHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monthLabel">{t('asg.fMonth')}</Label>
              <Select id="monthLabel" name="monthLabel" value={month} onChange={(e) => setMonth(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="">{t('asg.monthNone')}</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
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
                  key={p.uid}
                  index={i}
                  total={phases.length}
                  phase={p}
                  bank={bankInfo}
                  open={openPhase === i}
                  onToggle={() => setOpenPhase(openPhase === i ? -1 : i)}
                  onPatch={(patch) => patchPhase(i, patch)}
                  onMove={(dir) => movePhase(i, dir)}
                  onRemove={() => void removePhase(i)}
                />
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={addPhase}>
                <Plus className="h-4 w-4" />{t('asg.addPhase')}
              </Button>
            </div>

            <div className={wizard && step !== 2 ? 'hidden' : 'space-y-4'}>
              {/* 发布前小结：标题 / 发到哪个班 / 各环节提交类型与截止——发布前再核一遍。 */}
              {wizard ? (
                <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/40 p-3 text-sm">
                  <div className="text-xs font-semibold text-muted-foreground">{t('asg.summaryTitle')}</div>
                  <div><span className="text-muted-foreground">{t('asg.fTitle')}：</span><span className="font-medium">{title.trim() || t('asg.summaryNoTitle')}</span></div>
                  {targetLabels.length > 0 ? (
                    <div><span className="text-muted-foreground">{t('asg.publishTo')}：</span>{targetLabels.join(t('sep.list'))}</div>
                  ) : null}
                  <div>
                    <span className="text-muted-foreground">{t('asg.phases')}：</span>{phases.length} {t('asg.phaseUnit')}
                    <ul className="mt-1 space-y-1">
                      {phases.map((p, i) => (
                        <li key={p.uid} className="flex items-start gap-2 text-xs">
                          <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                          <span className="min-w-0">
                            <span className="font-medium">{p.title.trim() || t('phase.nth', { n: i + 1 })}</span>
                            {kindsOf(p) ? <span className="text-muted-foreground"> · {kindsOf(p)}</span> : null}
                            {p.dueAt ? <span className="text-muted-foreground"> · {t('asg.due')} {p.dueAt.replace('T', ' ')}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              {!editing ? (
                <div className="space-y-2 rounded-xl border border-input p-3">
                  <label className="flex items-center gap-2.5 text-sm">
                    <input type="checkbox" name="saveTemplate" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} className="h-4 w-4 accent-primary" />
                    {t('tmpl.saveAs')}
                  </label>
                  {saveTemplate ? (
                    <Input name="templateName" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={t('tmpl.namePh')} aria-label={t('tmpl.namePh')} maxLength={100} />
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
            <form action={deleteAssignment} onSubmit={confirmSubmit(confirm, { body: t('asg.deleteConfirm'), danger: true })}>
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
    phase.requireChoice && t('asg.kindChoice'),
    phase.requireFreeText && t('asg.kindFreeText'),
    phase.fillBlank && t('asg.kindFillBlank'),
  ].filter(Boolean).join(' / ')
  const summary = [phase.title.trim() || phase.category.trim(), kinds].filter(Boolean).join(' · ')
  // Live preview of what the student will hand in (video carries its eyes-closed note).
  const submitParts = [
    phase.requireVideo && (t('asg.kindVideo') + (phase.requireEyesClosed ? `（${t('rec.eyesClosed')}）` : '')),
    phase.requireAudio && t('asg.kindAudio'),
    phase.requireText && t('asg.kindText'),
    phase.requireHandwriting && t('asg.kindHandwriting'),
    phase.requireChoice && t('asg.kindChoice'),
    phase.requireFreeText && t('asg.kindFreeText'),
    phase.fillBlank && t('asg.kindFillBlank'),
  ].filter(Boolean)
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
      <Input value={phase.title} onChange={(e) => onPatch({ title: e.target.value })} placeholder={t('asg.phaseTitlePh')} aria-label={t('asg.phaseTitlePh')} />

      <div className="space-y-1.5">
        <Label>{t('asg.fCategory')}</Label>
        <Input list="category-presets" value={phase.category} onChange={(e) => onPatch({ category: e.target.value })} placeholder={t('asg.fCategoryPh')} aria-label={t('asg.fCategory')} />
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
            <Textarea rows={5} value={phase.sentences} onChange={(e) => onPatch({ sentences: e.target.value })} placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'} aria-label={t('asg.fSentences')} />
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
        <Textarea rows={2} value={phase.instructions} onChange={(e) => onPatch({ instructions: e.target.value })} placeholder={t('asg.fInstructionsPh')} aria-label={t('asg.fInstructions')} />
      </div>

      {/* Submission requirements */}
      <div className="space-y-2">
        <Label>{t('asg.submitKinds')}</Label>
        <div className="space-y-2.5 rounded-xl border border-input p-3 text-sm">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireVideo} onChange={(e) => onPatch({ requireVideo: e.target.checked })} className="h-4 w-4 accent-primary" />
            <Video className="h-4 w-4 text-muted-foreground" />{t('asg.kindVideo')}
          </label>
          {phase.requireVideo ? (
            <label className="flex items-center gap-2.5 pl-7 text-muted-foreground">
              <input type="checkbox" checked={phase.requireEyesClosed} onChange={(e) => onPatch({ requireEyesClosed: e.target.checked })} className="h-4 w-4 accent-primary" />
              <Eye className="h-4 w-4" />{t('asg.fEyes')}
            </label>
          ) : null}
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireAudio} onChange={(e) => onPatch({ requireAudio: e.target.checked })} className="h-4 w-4 accent-primary" />
            <Mic className="h-4 w-4 text-muted-foreground" />{t('asg.kindAudio')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireText} onChange={(e) => onPatch({ requireText: e.target.checked })} className="h-4 w-4 accent-primary" />
            <PenLine className="h-4 w-4 text-muted-foreground" />{t('asg.kindText')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireHandwriting} onChange={(e) => onPatch({ requireHandwriting: e.target.checked })} className="h-4 w-4 accent-primary" />
            <Camera className="h-4 w-4 text-muted-foreground" />{t('asg.kindHandwriting')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireChoice} onChange={(e) => onPatch({ requireChoice: e.target.checked, ...(e.target.checked && phase.choices.length < 2 ? { choices: ['', ''] } : {}) })} className="h-4 w-4 accent-primary" />
            <Check className="h-4 w-4 text-muted-foreground" />{t('asg.kindChoice')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.requireFreeText} onChange={(e) => onPatch({ requireFreeText: e.target.checked })} className="h-4 w-4 accent-primary" />
            <PenLine className="h-4 w-4 text-muted-foreground" />{t('asg.kindFreeText')}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={phase.fillBlank} onChange={(e) => onPatch({ fillBlank: e.target.checked })} className="h-4 w-4 accent-primary" />
            <Check className="h-4 w-4 text-muted-foreground" />{t('asg.kindFillBlank')}
          </label>
          {submitParts.length > 0 ? (
            <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">{t('asg.willSubmit')}{submitParts.join(' + ')}</p>
          ) : (
            <p className="border-t border-border/50 pt-2 text-xs text-warning">{t('asg.needKind')}</p>
          )}
        </div>
      </div>

      {/* 单选选项编辑器（老师任意增减）。左侧单选钮把某项设为正确答案 → 当作单选题、提交即
          客观判分；都不选（仅投票）→ 只统计票数分布、不判分。 */}
      {phase.requireChoice ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>{t('asg.choiceOptions')}</Label>
            <div className="flex items-center gap-3">
              {/* 单选 ↔ 多选切换：换模式清空已选正确项，避免残留脏数据。 */}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={phase.multiChoice} onChange={(e) => onPatch({ multiChoice: e.target.checked, correctIndex: -1, correctIndices: [] })} className="h-3.5 w-3.5 accent-primary" />
                {t('asg.multiChoice')}
              </label>
              {/* 判断题预设：两个选项（正确/错误）的单选，老师再点选哪个对。 */}
              <button type="button" onClick={() => onPatch({ choices: [t('asg.tfTrue'), t('asg.tfFalse')], multiChoice: false, correctIndex: -1, correctIndices: [] })} className="tap text-xs text-primary hover:underline">
                {t('asg.trueFalsePreset')}
              </button>
            </div>
          </div>
          <div className="space-y-2 rounded-xl border border-input p-3">
            {phase.choices.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                {phase.multiChoice ? (
                  <input
                    type="checkbox"
                    checked={phase.correctIndices.includes(oi)}
                    onChange={(e) => onPatch({ correctIndices: e.target.checked ? [...phase.correctIndices, oi].sort((a, b) => a - b) : phase.correctIndices.filter((x) => x !== oi) })}
                    className="h-4 w-4 shrink-0 accent-[hsl(var(--success))]"
                    title={t('asg.markCorrect')}
                    aria-label={t('asg.markCorrect')}
                  />
                ) : (
                  <input
                    type="radio"
                    name={`correct-${index}`}
                    checked={phase.correctIndex === oi}
                    onChange={() => onPatch({ correctIndex: oi })}
                    className="h-4 w-4 shrink-0 accent-[hsl(var(--success))]"
                    title={t('asg.markCorrect')}
                    aria-label={t('asg.markCorrect')}
                  />
                )}
                <Input value={opt} onChange={(e) => onPatch({ choices: phase.choices.map((c, j) => (j === oi ? e.target.value : c)) })} placeholder={t('asg.choiceOptionPh', { n: oi + 1 })} aria-label={t('asg.choiceOptionPh', { n: oi + 1 })} />
                <button type="button" onClick={() => onPatch({ choices: phase.choices.filter((_, j) => j !== oi), correctIndex: phase.correctIndex === oi ? -1 : phase.correctIndex > oi ? phase.correctIndex - 1 : phase.correctIndex, correctIndices: phase.correctIndices.filter((x) => x !== oi).map((x) => (x > oi ? x - 1 : x)) })} disabled={phase.choices.length <= 2} className="tap shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label={t('asg.removeOption')}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onPatch({ choices: [...phase.choices, ''] })}>
                <Plus className="h-4 w-4" />{t('asg.addOption')}
              </Button>
              {(phase.multiChoice ? phase.correctIndices.length > 0 : phase.correctIndex >= 0) ? (
                <button type="button" onClick={() => onPatch({ correctIndex: -1, correctIndices: [] })} className="tap text-xs text-muted-foreground hover:text-foreground">
                  {t('asg.clearCorrect')}
                </button>
              ) : null}
            </div>
            {/* 用途开关：仅当纯选择、无答案键时出现——把「选题」从「投票 hack」升格为一等公民。
                课堂民调(poll,默认) vs 选题·主题(theme,学生选一个感兴趣的主题)。分流(branch)留待后续。 */}
            {!(phase.multiChoice ? phase.correctIndices.length > 0 : phase.correctIndex >= 0) ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-input pt-2">
                <span className="text-xs font-medium text-muted-foreground">{t('asg.choiceUse')}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="radio" name={`use-${index}`} checked={(phase.selectionMode ?? 'poll') === 'poll'} onChange={() => onPatch({ selectionMode: 'poll' })} className="h-3.5 w-3.5 accent-primary" />
                  {t('asg.choiceUsePoll')}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="radio" name={`use-${index}`} checked={phase.selectionMode === 'theme'} onChange={() => onPatch({ selectionMode: 'theme' })} className="h-3.5 w-3.5 accent-primary" />
                  {t('asg.choiceUseTheme')}
                </label>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {phase.multiChoice
                ? (phase.correctIndices.length > 0 ? t('asg.multiGradedHint') : t('asg.multiPollHint'))
                : (phase.correctIndex >= 0 ? t('asg.choiceGradedHint') : t('asg.choicePollHint'))}
            </p>
          </div>
        </div>
      ) : null}

      {/* 填空题编辑器：题干用 ____（≥3 下划线）挖空；下面逐空填可接受答案（| 分隔多个）。 */}
      {phase.fillBlank ? (
        <div className="space-y-2">
          <Label>{t('asg.fillBlankTitle')}</Label>
          <Textarea value={phase.fillText} onChange={(e) => onPatch({ fillText: e.target.value })} rows={3} placeholder={t('asg.fillTextPh')} />
          <p className="text-xs text-muted-foreground">{t('asg.fillBlankHint')}</p>
          {(() => {
            const n = (phase.fillText.match(/_{3,}/g) ?? []).length
            if (n === 0) return null
            return (
              <div className="space-y-2 rounded-xl border border-input p-3">
                {Array.from({ length: n }, (_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">{t('asg.blankNth', { n: i + 1 })}</span>
                    <Input value={phase.fillAccept[i] ?? ''} onChange={(e) => onPatch({ fillAccept: Array.from({ length: n }, (_, j) => (j === i ? e.target.value : (phase.fillAccept[j] ?? ''))) })} placeholder={t('asg.fillAcceptPh')} aria-label={t('asg.blankNth', { n: i + 1 })} />
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      ) : null}

      {/* Time window + attempts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t('asg.fOpenAt')}</Label>
          <Input type="datetime-local" value={phase.openAt} onChange={(e) => onPatch({ openAt: e.target.value })} aria-label={t('asg.fOpenAt')} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('asg.fDueAt')}</Label>
          <Input type="datetime-local" value={phase.dueAt} onChange={(e) => onPatch({ dueAt: e.target.value })} aria-label={t('asg.fDueAt')} />
        </div>
      </div>
      {/* 进阶项收进「高级设置」，降低手机端默认密度（次数/计入成绩/正式测试/评分配置都有合理默认）。 */}
      <details className="rounded-xl border border-input">
        <summary className="tap cursor-pointer p-3 text-sm font-medium">
          {t('asg.moreSettings')}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{t('asg.moreSettingsHint')}</span>
        </summary>
        <div className="space-y-3 border-t border-border/60 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t('asg.fAttempts')}</Label>
          <Input type="number" min={1} value={phase.maxAttempts} onChange={(e) => onPatch({ maxAttempts: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('asg.fAttempts')} />
        </div>
        <label className="flex items-end gap-2.5 pb-2.5 text-sm">
          <input type="checkbox" checked={phase.graded} onChange={(e) => onPatch({ graded: e.target.checked })} className="h-4 w-4 accent-primary" />
          <span>{t('asg.graded')}<span className="block text-xs text-muted-foreground">{t('asg.gradedHint')}</span></span>
        </label>
      </div>

      {/* 环节权重（仅计分环节）：作业总分 = Σ(环节分×权重)/Σ权重 */}
      {phase.graded ? (
        <div className="space-y-1.5">
          <Label>{t('asg.fWeight')}</Label>
          <Input type="number" min={1} value={phase.weight} onChange={(e) => onPatch({ weight: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('asg.fWeight')} />
          <p className="text-xs text-muted-foreground">{t('asg.fWeightHint')}</p>
        </div>
      ) : null}

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

      {/* 每环节 AI 评阅配置：口语（音/视频）走「感知 + 评分」；写作（自由文本 / 默写）走
          「文本评分」，无感知阶段故不显示感知模型。都可设评分标准 + 评分模型；留空 = 跟随
          作业/平台默认。客观题 / 手写不走 AI，故不显示。 */}
      {(() => {
        const isSpeech = phase.requireVideo || phase.requireAudio
        const isWriting = !isSpeech && (phase.requireFreeText || phase.requireText)
        if (!isSpeech && !isWriting) return null
        return (
        <details className="rounded-xl border border-input">
          <summary className="tap flex cursor-pointer items-center gap-1.5 p-3 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />{t('asg.gradeCfg')}
            <span className="text-xs font-normal text-muted-foreground">{t('asg.gradeCfgHint')}</span>
          </summary>
          <div className="space-y-3 border-t border-border/60 p-3">
            <div className={isSpeech ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : ''}>
              {isSpeech ? (
                <div className="space-y-1.5">
                  <Label>{t('grade.perceptionModel')}</Label>
                  <Select value={phase.perceptionModel} onChange={(e) => onPatch({ perceptionModel: e.target.value })} aria-label={t('grade.perceptionModel')}>
                    <option value="">{t('asg.modelDefault')}</option>
                    {PERCEPTION_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </Select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label>{t('grade.judgeModel')}</Label>
                <Select value={phase.judgeModel} onChange={(e) => onPatch({ judgeModel: e.target.value })} aria-label={t('grade.judgeModel')}>
                  <option value="">{t('asg.modelDefault')}</option>
                  {JUDGE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('grade.rubric')}</Label>
              <Textarea value={phase.rubric} onChange={(e) => onPatch({ rubric: e.target.value })} rows={3} placeholder={isWriting ? t('grade.rubricPhWriting') : t('grade.rubricPh')} />
            </div>
          </div>
        </details>
        )
      })()}
        </div>
      </details>
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
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function generate() {
    setBusy(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.set('topic', topic)
      if (model) fd.set('authorModel', model)
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
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
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
        <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} placeholder={t('author.topicPh')} aria-label={t('author.topicPh')} />
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <ImageUp className="h-4 w-4" />{file ? t('author.photoChosen') : t('author.addPhoto')}
          </Button>
          {file ? <button type="button" onClick={() => setFile(null)} className="text-xs text-muted-foreground hover:text-foreground">{t('author.removePhoto')}</button> : null}
        </div>
        <div className="space-y-1.5">
          <Label>{t('author.model')}</Label>
          <Select value={model} onChange={(e) => setModel(e.target.value)} aria-label={t('author.model')}>
            <option value="">{t('author.modelDefault')}</option>
            {AUTHOR_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
          <p className="text-xs text-muted-foreground">{t('author.modelHint')}</p>
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
