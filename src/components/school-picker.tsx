'use client'

import { useState } from 'react'
import { useT } from './i18n-provider'
import { Input } from './ui/input'
import { Label } from './ui/label'

const SELECT = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm'

// Lets the user pick their school from a dropdown, or fall back to typing the
// school code (which is still supported). Emits `schoolId` or `schoolCode`.
export function SchoolPicker({ schools }: { schools: { id: number; name: string }[] }) {
  const t = useT()
  const [byCode, setByCode] = useState(schools.length === 0)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="school">{t('login.school')}</Label>
        {schools.length > 0 ? (
          <button
            type="button"
            onClick={() => setByCode((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {byCode ? t('login.pickFromList') : t('login.useCode')}
          </button>
        ) : null}
      </div>
      {byCode ? (
        <Input id="school" name="schoolCode" autoCapitalize="characters" required placeholder="WHPA" />
      ) : (
        <select id="school" name="schoolId" required defaultValue="" className={SELECT}>
          <option value="" disabled>{t('login.selectSchool')}</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}
