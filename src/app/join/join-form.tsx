'use client'

import { useActionState } from 'react'
import { acceptInvite } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function JoinForm({ token }: { token: string }) {
  const t = useT()
  const [state, action, pending] = useActionState(acceptInvite, null)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Input name="name" required maxLength={50} placeholder={t('join.name')} />
      <Input name="email" type="email" required maxLength={120} placeholder={t('join.email')} />
      <Input name="password" type="password" required placeholder={t('join.password')} />
      {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
      <Button type="submit" disabled={pending} size="lg" className="w-full">
        {pending ? t('join.joining') : t('join.submit')}
      </Button>
    </form>
  )
}
