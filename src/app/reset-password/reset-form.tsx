'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { resetPassword } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

export function ResetForm({ token }: { token: string }) {
  const t = useT()
  const [state, action, isPending] = useActionState(resetPassword, null)

  return (
    <AuthShell
      icon={<KeyRound className="h-7 w-7" />}
      title={t('reset.title')}
      footer={
        <Link href="/login" className="font-semibold text-primary">
          {t('verify.backSignIn')}
        </Link>
      }
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('reset.newPw')}</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={8} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t('reset.confirmPw')}</Label>
          <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required minLength={8} />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        {state?.success ? <FormMessage tone="success">{t('reset.updated')}</FormMessage> : null}
        <Button type="submit" disabled={isPending || !token || Boolean(state?.success)} size="lg" className="w-full">
          {isPending ? t('reset.updating') : t('reset.update')}
        </Button>
      </form>
    </AuthShell>
  )
}
