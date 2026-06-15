'use client'

import { useActionState } from 'react'
import { updateStaffNo } from '@/actions/auth'
import { renameSchool } from '@/actions/schools'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function StaffSettings({ staffNo, schoolName, hasSchool }: { staffNo: string; schoolName: string; hasSchool: boolean }) {
  const t = useT()
  const [noState, noAction, noPending] = useActionState(updateStaffNo, null)
  const [schState, schAction, schPending] = useActionState(renameSchool, null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('prof.staffNo')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={noAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="staffNo">{t('login.staffNo')}</Label>
              <Input id="staffNo" name="staffNo" defaultValue={staffNo} inputMode="numeric" placeholder="80103" />
              <p className="text-xs text-muted-foreground">{t('prof.staffNoHint')}</p>
            </div>
            {noState?.error ? <FormMessage>{noState.error}</FormMessage> : null}
            {noState?.success ? <FormMessage tone="success">{t('prof.updated')}</FormMessage> : null}
            <Button type="submit" disabled={noPending}>{t('cls.save')}</Button>
          </form>
        </CardContent>
      </Card>

      {hasSchool ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('prof.schoolName')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={schAction} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="schoolName">{t('prof.schoolName')}</Label>
                <Input id="schoolName" name="name" defaultValue={schoolName} required placeholder="武汉警官职业学院" />
              </div>
              {schState?.error ? <FormMessage>{schState.error}</FormMessage> : null}
              {schState?.success ? <FormMessage tone="success">{t('prof.updated')}</FormMessage> : null}
              <Button type="submit" disabled={schPending}>{t('cls.save')}</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
