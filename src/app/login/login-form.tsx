'use client'

import { useActionState } from 'react'
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
  const [state, action, isPending] = useActionState(login, null)

  // Default to 武汉警官职业学院 (or the only school if there's just one).
  const preferredId = (schools.find((s) => s.name.includes('武汉警官职业学院')) ?? (schools.length === 1 ? schools[0] : undefined))?.id

  return (
    <AuthShell icon={<LogIn className="h-7 w-7" />} title={t('login.title')} description={t('login.subtitle')}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={next} />
        <div className="space-y-1.5">
          <Label htmlFor="school">{t('login.school')}</Label>
          <select id="school" name="schoolId" required defaultValue={preferredId != null ? String(preferredId) : ''} className={SELECT}>
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
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('tlogin.signingIn') : t('signIn')}
        </Button>
        <div className="text-center text-sm">
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">{t('tlogin.forgot')}</Link>
        </div>
      </form>
    </AuthShell>
  )
}
