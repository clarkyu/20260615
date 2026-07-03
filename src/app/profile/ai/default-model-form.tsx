'use client'

import { useActionState } from 'react'
import { setDefaultModels } from '@/actions/ai-keys'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'


export function DefaultModelForm({
  perceptionOptions,
  judgeOptions,
  perception,
  judge,
}: {
  perceptionOptions: { id: string; label: string }[]
  judgeOptions: { id: string; label: string }[]
  perception: string | null
  judge: string | null
}) {
  const t = useT()
  const [state, action, pending] = useActionState(setDefaultModels, null)

  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="perception">{t('ai.perceptionModel')}</Label>
        <Select id="perception" name="perception" defaultValue={perception ?? ''}>
          <option value="">{t('ai.platformDefault')}</option>
          {perceptionOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="judge">{t('ai.judgeModel')}</Label>
        <Select id="judge" name="judge" defaultValue={judge ?? ''}>
          <option value="">{t('ai.platformDefault')}</option>
          {judgeOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
      </div>
      {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
      {state?.ok ? <FormMessage tone="success">{t('ai.saved')}</FormMessage> : null}
      <Button type="submit" size="sm" disabled={pending}>{pending ? t('ai.saving') : t('ai.save')}</Button>
    </form>
  )
}
