'use client'

import { useActionState, useMemo, useState } from 'react'
import { createAssignment, updateAssignment, deleteAssignment } from '@/actions/assignments'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface AssignmentInitial {
  id: number
  title: string
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
}

export interface PublishTarget {
  offeringId: number
  label: string
}

export function AssignmentForm({
  offeringId,
  targets,
  initial,
}: {
  offeringId?: number
  targets?: PublishTarget[]
  initial?: AssignmentInitial
}) {
  const t = useT()
  const editing = Boolean(initial)
  const [state, action, isPending] = useActionState(editing ? updateAssignment : createAssignment, null)
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

  return (
    <div className="space-y-4">
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
              <Input id="title" name="title" required defaultValue={initial?.title} />
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
              <Textarea id="instructions" name="instructions" rows={3} defaultValue={initial?.instructions} placeholder={t('asg.fInstructionsPh')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sentences">{t('asg.fSentences')}</Label>
              <p className="text-xs text-muted-foreground">{t('asg.fSentencesHint')}</p>
              <Textarea id="sentences" name="sentences" rows={6} defaultValue={initial?.sentences} placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'} />
            </div>
            <div className="space-y-2">
              <Label>{t('asg.submitKinds')}</Label>
              <div className="space-y-2.5 rounded-xl border border-input p-3 text-sm">
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="requireText" defaultChecked={initial?.requireText ?? true} className="h-4 w-4 accent-primary" />
                  {t('asg.kindText')}
                </label>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="requireVideo" defaultChecked={initial?.requireVideo ?? true} className="h-4 w-4 accent-primary" />
                  {t('asg.kindVideo')}
                </label>
                <label className="flex items-center gap-2.5 pl-6 text-muted-foreground">
                  <input type="checkbox" name="requireEyesClosed" defaultChecked={initial?.requireEyesClosed ?? true} className="h-4 w-4 accent-primary" />
                  {t('asg.fEyes')}
                </label>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="requireAudio" defaultChecked={initial?.requireAudio ?? false} className="h-4 w-4 accent-primary" />
                  {t('asg.kindAudio')}
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="openAt">{t('asg.fOpenAt')}</Label>
                <Input id="openAt" name="openAt" type="datetime-local" defaultValue={initial?.openAt} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dueAt">{t('asg.fDueAt')}</Label>
                <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={initial?.dueAt} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxAttempts">{t('asg.fAttempts')}</Label>
              <Input id="maxAttempts" name="maxAttempts" type="number" min={1} defaultValue={initial?.maxAttempts ?? 1} className="w-32" />
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
              <Button type="submit" variant="destructive" className="w-full">{t('asg.delete')}</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
