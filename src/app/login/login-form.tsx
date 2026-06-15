'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { BookOpenCheck } from 'lucide-react'
import { login, resendVerification } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { SchoolPicker } from '@/components/school-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm({ next, schools }: { next: string; schools: { id: number; name: string }[] }) {
  const t = useT()
  const [email, setEmail] = useState('')
  const [byEmail, setByEmail] = useState(false)
  const [state, action, isPending] = useActionState(login, null)
  const [resendState, resendAction, resendPending] = useActionState(resendVerification, null)

  return (
    <AuthShell
      icon={<BookOpenCheck className="h-7 w-7" />}
      title={t('tlogin.title')}
      description={t('tlogin.desc')}
      footer={
        <>
          {t('tlogin.noAccount')}{' '}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-primary">
            {t('register')}
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={next} />
        {byEmail ? (
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
        ) : (
          <>
            <SchoolPicker schools={schools} />
            <div className="space-y-1.5">
              <Label htmlFor="staffNo">{t('login.staffNo')}</Label>
              <Input id="staffNo" name="staffNo" required inputMode="numeric" placeholder="80103" />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('tlogin.signingIn') : t('signIn')}
        </Button>
        <button type="button" onClick={() => setByEmail((v) => !v)} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">
          {byEmail ? t('login.useStaffNo') : t('login.useEmail')}
        </button>
      </form>

      {state?.needsVerification ? (
        <form action={resendAction} className="space-y-2 border-t border-border/60 pt-4">
          <input type="hidden" name="email" value={email} />
          <p className="text-sm text-muted-foreground">{t('tlogin.needVerify')}</p>
          {resendState?.success ? <FormMessage tone="success">{t('tlogin.resent')}</FormMessage> : null}
          <Button type="submit" variant="outline" disabled={resendPending} className="w-full">
            {resendPending ? t('loading') : t('tlogin.resend')}
          </Button>
        </form>
      ) : null}

      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
          {t('tlogin.forgot')}
        </Link>
        <Link href="/student-login" className="text-muted-foreground hover:text-foreground">
          {t('slogin.imStudent')}
        </Link>
      </div>
    </AuthShell>
  )
}
