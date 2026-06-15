'use client'

import { useActionState } from 'react'
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
  sentences: string
  openAt: string
  dueAt: string
  maxAttempts: number
  requireEyesClosed: boolean
}

export function AssignmentForm({ offeringId, initial }: { offeringId?: number; initial?: AssignmentInitial }) {
  const t = useT()
  const editing = Boolean(initial)
  const [state, action, isPending] = useActionState(editing ? updateAssignment : createAssignment, null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{editing ? t('asg.editTitle') : t('asg.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            {editing ? <input type="hidden" name="assignmentId" value={initial!.id} /> : <input type="hidden" name="offeringId" value={offeringId} />}
            <div className="space-y-1.5">
              <Label htmlFor="title">{t('asg.fTitle')}</Label>
              <Input id="title" name="title" required defaultValue={initial?.title} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monthLabel">{t('asg.fMonth')}</Label>
              <Input id="monthLabel" name="monthLabel" placeholder="2026-05" defaultValue={initial?.monthLabel} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sentences">{t('asg.fSentences')}</Label>
              <Textarea id="sentences" name="sentences" required rows={8} defaultValue={initial?.sentences} placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'} />
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
            <div className="grid grid-cols-2 items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="maxAttempts">{t('asg.fAttempts')}</Label>
                <Input id="maxAttempts" name="maxAttempts" type="number" min={1} defaultValue={initial?.maxAttempts ?? 1} />
              </div>
              <label className="flex items-center gap-2.5 pb-3 text-sm">
                <input type="checkbox" name="requireEyesClosed" defaultChecked={initial?.requireEyesClosed ?? true} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                {t('asg.fEyes')}
              </label>
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
