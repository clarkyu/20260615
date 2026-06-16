'use client'

import { useActionState, useEffect, useRef } from 'react'
import { UserPlus } from 'lucide-react'
import { addTeacher } from '@/actions/staff'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AddTeacherForm() {
  const t = useT()
  const [state, action, pending] = useActionState(addTeacher, null)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state?.success) formRef.current?.reset()
  }, [state])

  return (
    <Card>
      <CardContent className="p-4">
        <form ref={formRef} action={action} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">{t('teacher.name')}</Label>
              <Input id="t-name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-no">{t('teacher.staffNo')}</Label>
              <Input id="t-no" name="staffNo" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-phone">{t('teacher.phone')}</Label>
              <Input id="t-phone" name="phone" inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-email">{t('teacher.email')}</Label>
              <Input id="t-email" name="email" type="email" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('teacher.pwHint')}</p>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          {state?.success ? <FormMessage tone="success">{t('teacher.added')}</FormMessage> : null}
          <Button type="submit" disabled={pending}>
            <UserPlus className="h-4 w-4" />{pending ? t('teacher.adding') : t('teacher.add')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
