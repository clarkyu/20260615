'use client'

import { useActionState } from 'react'
import { updatePhone } from '@/actions/auth'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ContactSettings({ phone }: { phone: string }) {
  const t = useT()
  const [state, action, pending] = useActionState(updatePhone, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('prof.contact')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t('prof.phone')}</Label>
            <Input id="phone" name="phone" defaultValue={phone} inputMode="tel" autoComplete="tel" placeholder="138…" />
          </div>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state?.success ? <FormMessage tone="success">{t('prof.updated')}</FormMessage> : null}
          <Button type="submit" disabled={pending}>{t('cls.save')}</Button>
        </form>
      </CardContent>
    </Card>
  )
}
