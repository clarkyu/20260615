'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, ImageUp } from 'lucide-react'
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

export interface AssignmentInitial {
  id: number
  title: string
  category: string
  monthLabel: string
  instructions: string
  sentences: string
  openAt: string
  dueAt: string
  maxAttempts: number
  requireEyesClosed: boolean
  requireText: boolean
  requireAudio: boolean
  requireVideo: boolean
  requireHandwriting: boolean
}

const CATEGORY_PRESETS = ['背诵作业', '口语作业', '书面作业', '试卷作业', '听写作业', '默写作业']

// Open/due times round-trip through the browser, where the timezone is known. A
// `datetime-local` input is a *local* wall-clock; a UTC server would otherwise read
// it as UTC (e.g. 8h off in China — assignments would look "not open yet"). So we
// convert UTC ISO → local for display, and local → UTC ISO (hidden field) on submit.
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
  const editing = Boolean(initial)
  // Shadowing assignment (from the item bank): sentences + video come from the set,
  // and recording audio is the natural submission.
  const shadow = Boolean(chunkSet)
  const dAudio = initial?.requireAudio ?? (shadow ? true : false)
  const dVideo = initial?.requireVideo ?? (shadow ? false : true)
  const dText = initial?.requireText ?? false
  const dEyes = initial?.requireEyesClosed ?? (shadow ? false : true)
  const dHand = initial?.requireHandwriting ?? false
  const [state, action, isPending] = useActionState(editing ? updateAssignment : createAssignment, null)

  // Core text fields are controlled so the AI draft can fill them.
  const [title, setTitle] = useState(initial?.title ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [sentences, setSentences] = useState(initial?.sentences ?? '')
  function applyDraft(d: DraftFields) {
    if (d.title) setTitle(d.title)
    if (d.category) setCategory(d.category)
    if (d.instructions) setInstructions(d.instructions)
    if (d.sentences) setSentences(d.sentences)
  }
  const multi = !editing && (targets?.length ?? 0) > 1
  // When not multi, publish to the pre-selected offering, or the only candidate.
  const singleOfferingId = offeringId ?? targets?.[0]?.offeringId

  // Controlled multi-select so "select all" works.
  const [selected, setSelected] = useState<Set<number>>(() => new Set(offeringId != null ? [offeringId] : []))
  const allSelected = (targets?.length ?? 0) > 0 && selected.size === targets!.length
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Month dropdown: previous month through next 11, plus the existing value.
  const months = useMemo(() => {
    const out: string[] = []
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
    for (let i = 0; i < 13; i++) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      d.setMonth(d.getMonth() + 1)
    }
    return out
  }, [])
  const monthOptions = initial?.monthLabel && !months.includes(initial.monthLabel) ? [initial.monthLabel, ...months] : months
  const now = new Date()
  const defaultMonth = initial?.monthLabel ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Open/due as local-time input values; the hidden fields submit the UTC instant.
  const [openAt, setOpenAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  useEffect(() => {
    setOpenAt(initial?.openAt ? toLocalInput(initial.openAt) : '')
    setDueAt(initial?.dueAt ? toLocalInput(initial.dueAt) : '')
  }, [initial?.openAt, initial?.dueAt])

  return (
    <div className="space-y-4">
      {!editing && !shadow ? <AiDraftPanel onApply={applyDraft} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{editing ? t('asg.editTitle') : t('asg.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            {editing ? <input type="hidden" name="assignmentId" value={initial!.id} /> : <input type="hidden" name="primaryOfferingId" value={singleOfferingId ?? ''} />}
            {!editing && !multi ? <input type="hidden" name="offeringId" value={singleOfferingId ?? ''} /> : null}

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

            <div className="space-y-1.5">
              <Label htmlFor="title">{t('asg.fTitle')}</Label>
              <Input id="title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">{t('asg.fCategory')}</Label>
              <Input id="category" name="category" list="category-presets" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('asg.fCategoryPh')} />
              <datalist id="category-presets">
                {CATEGORY_PRESETS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monthLabel">{t('asg.fMonth')}</Label>
              <select id="monthLabel" name="monthLabel" defaultValue={defaultMonth} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="">{t('asg.monthNone')}</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="instructions">{t('asg.fInstructions')}</Label>
              <Textarea id="instructions" name="instructions" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t('asg.fInstructionsPh')} />
            </div>
            {chunkSet ? (
              <div className="space-y-1.5">
                <Label>{t('asg.fSentences')}</Label>
                <input type="hidden" name="chunkSetId" value={chunkSet.id} />
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="font-medium">{t('asg.fromBank')}：{chunkSet.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {chunkSet.count} {t('bank.chunkUnit')} · {chunkSet.hasVideo ? t('bank.hasVideo') : t('bank.noVideo')}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="sentences">{t('asg.fSentences')}</Label>
                <p className="text-xs text-muted-foreground">{t('asg.fSentencesHint')}</p>
                <Textarea id="sentences" name="sentences" rows={6} value={sentences} onChange={(e) => setSentences(e.target.value)} placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'} />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('asg.submitKinds')}</Label>
              <div className="space-y-2.5 rounded-xl border border-input p-3 text-sm">
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="requireVideo" defaultChecked={dVideo} className="h-4 w-4 accent-primary" />
                  {t('asg.kindVideo')}
                </label>
                <label className="flex items-center gap-2.5 pl-6 text-muted-foreground">
                  <input type="checkbox" name="requireEyesClosed" defaultChecked={dEyes} className="h-4 w-4 accent-primary" />
                  {t('asg.fEyes')}
                </label>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="requireAudio" defaultChecked={dAudio} className="h-4 w-4 accent-primary" />
                  {t('asg.kindAudio')}
                </label>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="requireText" defaultChecked={dText} className="h-4 w-4 accent-primary" />
                  {t('asg.kindText')}
                </label>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="requireHandwriting" defaultChecked={dHand} className="h-4 w-4 accent-primary" />
                  {t('asg.kindHandwriting')}
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="openAt">{t('asg.fOpenAt')}</Label>
                <input type="hidden" name="openAt" value={localToIso(openAt)} />
                <Input id="openAt" type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dueAt">{t('asg.fDueAt')}</Label>
                <input type="hidden" name="dueAt" value={localToIso(dueAt)} />
                <Input id="dueAt" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxAttempts">{t('asg.fAttempts')}</Label>
              <Input id="maxAttempts" name="maxAttempts" type="number" min={1} defaultValue={initial?.maxAttempts ?? 3} className="w-32" />
              <p className="text-xs text-muted-foreground">{t('asg.fAttemptsHint')}</p>
            </div>
            {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
            <Button type="submit" disabled={isPending} size="lg" className="w-full">
              {isPending ? (editing ? t('asg.saving') : t('asg.publishing')) : editing ? t('asg.save') : t('asg.publish')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {editing ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4">
            <form action={deleteAssignment} onSubmit={(e) => { if (!confirm(t('asg.deleteConfirm'))) e.preventDefault() }}>
              <input type="hidden" name="assignmentId" value={initial!.id} />
              <SubmitButton variant="destructive" className="w-full">{t('asg.delete')}</SubmitButton>
            </form>
          </CardContent>
        </Card>
      ) : null}
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
