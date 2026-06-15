'use client'

import { useActionState } from 'react'
import { createSchool } from '@/actions/schools'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CreateSchoolForm() {
  const t = useT()
  const [state, action, isPending] = useActionState(createSchool, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dash.createSchool')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('dash.schoolName')}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">{t('dash.schoolCode')}</Label>
            <Input id="code" name="code" required placeholder="WHPA" autoCapitalize="characters" />
            <p className="text-xs text-muted-foreground">{t('dash.schoolCodeHint')}</p>
          </div>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state?.success ? <FormMessage tone="success">{t('done')}</FormMessage> : null}
          <Button type="submit" disabled={isPending} size="lg" className="w-full">
            {isPending ? t('loading') : t('dash.createSchool')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
