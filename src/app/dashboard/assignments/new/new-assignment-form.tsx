'use client'

import { useActionState } from 'react'
import { createAssignment } from '@/actions/assignments'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function NewAssignmentForm({ classes }: { classes: { id: number; name: string }[] }) {
  const t = useT()
  const [state, action, isPending] = useActionState(createAssignment, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('asg.newTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">{t('asg.fTitle')}</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="monthLabel">{t('asg.fMonth')}</Label>
            <Input id="monthLabel" name="monthLabel" placeholder="2026-05" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sentences">{t('asg.fSentences')}</Label>
            <Textarea id="sentences" name="sentences" required rows={8} placeholder={'1. The early bird catches the worm.\n2. Actions speak louder than words.'} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('asg.fClasses')}</Label>
            <div className="space-y-1 rounded-xl border border-border p-3">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 py-1 text-sm">
                  <input type="checkbox" name="classIds" value={c.id} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="openAt">{t('asg.fOpenAt')}</Label>
              <Input id="openAt" name="openAt" type="datetime-local" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueAt">{t('asg.fDueAt')}</Label>
              <Input id="dueAt" name="dueAt" type="datetime-local" />
            </div>
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="maxAttempts">{t('asg.fAttempts')}</Label>
              <Input id="maxAttempts" name="maxAttempts" type="number" min={1} defaultValue={1} />
            </div>
            <label className="flex items-center gap-2.5 pb-3 text-sm">
              <input type="checkbox" name="requireEyesClosed" defaultChecked className="h-4 w-4 accent-[hsl(var(--primary))]" />
              {t('asg.fEyes')}
            </label>
          </div>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          <Button type="submit" disabled={isPending} size="lg" className="w-full">
            {isPending ? t('asg.publishing') : t('asg.publish')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
