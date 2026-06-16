'use client'

import { useActionState, useState } from 'react'
import { Plus } from 'lucide-react'
import { createPlatformSchool } from '@/actions/schools'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Super-admin creates a school for the platform (no self-binding). Collapsed by
// default so the schools list stays the focus.
export function CreatePlatformSchoolForm() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [state, action, isPending] = useActionState(createPlatformSchool, null)

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />{t('plat.newSchool')}
      </Button>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ps-name">{t('dash.schoolName')}</Label>
            <Input id="ps-name" name="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ps-code">{t('dash.schoolCode')}</Label>
            <Input id="ps-code" name="code" required placeholder="WHPA" autoCapitalize="characters" />
            <p className="text-xs text-muted-foreground">{t('dash.schoolCodeHint')}</p>
          </div>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state?.success ? <FormMessage tone="success">{t('done')}</FormMessage> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending}>{isPending ? t('loading') : t('plat.newSchool')}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('stu.cancelClass')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
