'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { LogIn } from 'lucide-react'
import { login } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

const SELECT = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm'

export function LoginForm({ next, schools }: { next: string; schools: { id: number; name: string }[] }) {
  const t = useT()
  const [byEmail, setByEmail] = useState(false)
  const [state, action, isPending] = useActionState(login, null)

  return (
    <AuthShell icon={<LogIn className="h-7 w-7" />} title={t('login.title')} description={t('login.subtitle')}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={next} />
        {byEmail ? (
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="school">{t('login.school')}</Label>
              <select id="school" name="schoolId" required defaultValue="" className={SELECT}>
                <option value="" disabled>{t('login.selectSchool')}</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identifier">{t('login.idOrStaff')}</Label>
              <Input id="identifier" name="identifier" required inputMode="numeric" autoComplete="username" />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('tlogin.signingIn') : t('signIn')}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button type="button" onClick={() => setByEmail((v) => !v)} className="text-muted-foreground hover:text-foreground">
            {byEmail ? t('login.useStaffNo') : t('login.useEmail')}
          </button>
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">{t('tlogin.forgot')}</Link>
        </div>
      </form>
    </AuthShell>
  )
}
