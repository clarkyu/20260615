'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { studentLogin } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { AuthShell } from '@/components/auth-shell'
import { FormMessage } from '@/components/form-message'
import { SchoolPicker } from '@/components/school-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

export function StudentLoginForm({ schools }: { schools: { id: number; name: string }[] }) {
  const t = useT()
  const [state, action, isPending] = useActionState(studentLogin, null)

  return (
    <AuthShell
      icon={<GraduationCap className="h-7 w-7" />}
      title={t('slogin.title')}
      description={t('slogin.desc')}
      footer={
        <Link href="/login" className="font-semibold text-primary">
          {t('slogin.imTeacher')}
        </Link>
      }
    >
      <form action={action} className="space-y-4">
        <SchoolPicker schools={schools} />
        <div className="space-y-1.5">
          <Label htmlFor="studentNo">{t('slogin.studentId')}</Label>
          <Input id="studentNo" name="studentNo" required inputMode="numeric" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <PasswordInput id="password" name="password" autoComplete="current-password" required placeholder={t('slogin.initialPw')} />
        </div>
        {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
        <Button type="submit" disabled={isPending} size="lg" className="w-full">
          {isPending ? t('loading') : t('signIn')}
        </Button>
      </form>
    </AuthShell>
  )
}
