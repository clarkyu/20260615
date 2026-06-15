'use client'

import { useActionState } from 'react'
import { updateStaffProfile } from '@/actions/auth'
import { renameSchool } from '@/actions/schools'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const SELECT = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm'

export function StaffSettings({
  staffNo,
  departmentId,
  departments,
  schoolName,
  hasSchool,
}: {
  staffNo: string
  departmentId: number | null
  departments: { id: number; name: string }[]
  schoolName: string
  hasSchool: boolean
}) {
  const t = useT()
  const [pState, pAction, pPending] = useActionState(updateStaffProfile, null)
  const [schState, schAction, schPending] = useActionState(renameSchool, null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('prof.staffProfile')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={pAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="staffNo">{t('login.staffNo')}</Label>
              <Input id="staffNo" name="staffNo" defaultValue={staffNo} inputMode="numeric" placeholder="80103" />
              <p className="text-xs text-muted-foreground">{t('prof.staffNoHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="departmentId">{t('prof.department')}</Label>
              <select id="departmentId" name="departmentId" defaultValue={departmentId ?? ''} className={SELECT}>
                <option value="">{t('prof.noDept')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            {pState?.error ? <FormMessage>{pState.error}</FormMessage> : null}
            {pState?.success ? <FormMessage tone="success">{t('prof.updated')}</FormMessage> : null}
            <Button type="submit" disabled={pPending}>{t('cls.save')}</Button>
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
