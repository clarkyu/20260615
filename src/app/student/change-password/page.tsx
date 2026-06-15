'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { changePassword } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

export default function StudentChangePasswordPage() {
  const t = useT()
  const [state, action, isPending] = useActionState(changePassword, null)

  if (state?.success) {
    return (
      <AuthShell icon={<KeyRound className="h-7 w-7" />} title={t('prof.updated')} description={t('change.changed')}>
        <Link href="/login">
          <Button className="w-full" size="lg">{t('change.toSignIn')}</Button>
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell icon={<KeyRound className="h-7 w-7" />} title={t('change.title')} description={t('change.desc')}>
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">{t('change.currentId')}</Label>
          <PasswordInput id="currentPassword" name="currentPassword" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">{t('reset.newPw')}</Label>
          <PasswordInput id="newPassword" name="newPassword" required minLength={8} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t('reset.confirmPw')}</Label>
          <PasswordInput id="confirmPassword" name="confirmPassword" required minLength={8} />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('reset.updating') : t('prof.changePw')}
        </Button>
      </form>
    </AuthShell>
  )
}
