'use client'

import { useActionState, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { saveAiKey, deleteAiKey } from '@/actions/ai-keys'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/submit-button'
import { PasswordInput } from '@/components/ui/password-input'

export function AiKeySlot({ id, label, help, last4 }: { id: string; label: string; help: string; last4: string | null }) {
  const t = useT()
  const [state, action, pending] = useActionState(saveAiKey, null)
  const [editing, setEditing] = useState(false)
  // After a successful save the server revalidates `last4`; collapse the editor.
  useEffect(() => { if (state?.ok) setEditing(false) }, [state?.ok])

  const showForm = editing || !last4

  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
        </div>
        {last4 ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
            <Check className="h-4 w-4" />{t('ai.configured')} ••••{last4}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">{t('ai.notSet')}</span>
        )}
      </div>

      {showForm ? (
        <form action={action} className="mt-2.5 space-y-2">
          <input type="hidden" name="provider" value={id} />
          <PasswordInput name="key" placeholder={t('ai.keyPlaceholder')} autoComplete="off" />
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{pending ? t('ai.saving') : t('ai.save')}</Button>
            {last4 ? <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('ai.cancel')}</Button> : null}
          </div>
        </form>
      ) : (
        <div className="mt-2.5 flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>{t('ai.replace')}</Button>
          <form action={deleteAiKey}>
            <input type="hidden" name="provider" value={id} />
            <SubmitButton size="sm" variant="ghost" className="text-destructive">{t('ai.remove')}</SubmitButton>
          </form>
        </div>
      )}
    </div>
  )
}
