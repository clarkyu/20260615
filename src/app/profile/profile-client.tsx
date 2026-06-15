'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { changePassword } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProfileClient() {
  const t = useT()
  const [state, action, pending] = useActionState(changePassword, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('prof.changePw')}</CardTitle>
      </CardHeader>
      <CardContent>
        {state?.success ? (
          <div className="space-y-3">
            <FormMessage tone="success">{t('prof.updated')}</FormMessage>
            <Link href="/" className="text-sm font-semibold text-primary">
              {t('prof.signInAgain')} →
            </Link>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">{t('prof.currentPw')}</Label>
              <Input id="currentPassword" name="currentPassword" type="password" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">{t('prof.newPw')}</Label>
              <Input id="newPassword" name="newPassword" type="password" required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">{t('prof.confirmPw')}</Label>
              <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} />
            </div>
            {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
            <Button type="submit" disabled={pending} size="lg" className="w-full">
              {pending ? t('prof.updating') : t('prof.changePw')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
