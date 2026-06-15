'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { requestPasswordReset } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ForgotPasswordPage() {
  const t = useT()
  const [state, action, isPending] = useActionState(requestPasswordReset, null)

  return (
    <AuthShell
      icon={<KeyRound className="h-7 w-7" />}
      title={t('forgot.title')}
      description={t('forgot.desc')}
      footer={
        <Link href="/login" className="font-semibold text-primary">
          {t('verify.backSignIn')}
        </Link>
      }
    >
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        {state?.success ? <FormMessage tone="success">{t('forgot.sent')}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('forgot.sending') : t('forgot.send')}
        </Button>
      </form>
    </AuthShell>
  )
}
