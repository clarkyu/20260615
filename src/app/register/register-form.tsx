'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { MailCheck, UserPlus } from 'lucide-react'
import { register, resendVerification } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RegisterForm({ next }: { next: string }) {
  const t = useT()
  const [email, setEmail] = useState('')
  const [state, action, isPending] = useActionState(register, null)
  const [resendState, resendAction, resendPending] = useActionState(resendVerification, null)

  if (state?.success) {
    return (
      <AuthShell
        icon={<MailCheck className="h-7 w-7" />}
        title={t('reg.checkInbox')}
        description={`${t('reg.sentTo')} ${email}. ${t('reg.clickToActivate')}`}
        footer={
          <Link href="/login" className="font-semibold text-primary">
            {t('signIn')}
          </Link>
        }
      >
        <form action={resendAction} className="space-y-3">
          <input type="hidden" name="email" value={email} />
          <p className="text-sm text-muted-foreground">{t('reg.notGet')}</p>
          {resendState?.success ? <FormMessage tone="success">{t('reg.resent')}</FormMessage> : null}
          <Button type="submit" variant="outline" disabled={resendPending} className="w-full">
            {resendPending ? t('loading') : t('reg.resend')}
          </Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      icon={<UserPlus className="h-7 w-7" />}
      title={t('reg.title')}
      description={t('reg.desc')}
      footer={
        <>
          {t('reg.have')}{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-primary">
            {t('signIn')}
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={next} />
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('name')} <span className="text-muted-foreground">({t('optional')})</span></Label>
          <Input id="name" name="name" type="text" autoComplete="name" maxLength={60} placeholder={t('reg.namePh')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} placeholder={t('reg.pwHint')} />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('reg.creating') : t('reg.create')}
        </Button>
      </form>
    </AuthShell>
  )
}
