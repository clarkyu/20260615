'use client'

import { useActionState } from 'react'
import { createOffering, updateOffering, deleteOffering } from '@/actions/offerings'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface OfferingInitial {
  id: number
  courseName: string
  courseCode: string
  classId: number
  year: string
  semester: string
}

const SELECT = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm'

function currentAcademicYear(): string {
  const now = new Date()
  const y = now.getFullYear()
  return now.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`
}

export function OfferingForm({ classes, initial }: { classes: { id: number; name: string }[]; initial?: OfferingInitial }) {
  const t = useT()
  const editing = Boolean(initial)
  const [state, action, isPending] = useActionState(editing ? updateOffering : createOffering, null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{editing ? t('teach.editTitle') : t('teach.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            {editing ? <input type="hidden" name="offeringId" value={initial!.id} /> : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cn">{t('teach.courseName')}</Label>
                <Input id="cn" name="courseName" required defaultValue={initial?.courseName} placeholder="大学英语（二）" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc">{t('teach.courseCode')}</Label>
                <Input id="cc" name="courseCode" required defaultValue={initial?.courseCode} placeholder="ENG102" autoCapitalize="characters" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cls">{t('teach.class')}</Label>
              <select id="cls" name="classId" defaultValue={initial?.classId ?? ''} required className={SELECT}>
                <option value="" disabled>—</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="yr">{t('teach.year')}</Label>
                <Input id="yr" name="year" required defaultValue={initial?.year ?? currentAcademicYear()} placeholder="2025-2026" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sem">{t('teach.semester')}</Label>
                <select id="sem" name="semester" defaultValue={initial?.semester ?? '1'} className={SELECT}>
                  <option value="1">{t('teach.sem1')}</option>
                  <option value="2">{t('teach.sem2')}</option>
                </select>
              </div>
            </div>
            {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
            <Button type="submit" disabled={isPending} size="lg" className="w-full">
              {editing ? t('teach.save') : t('teach.create')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {editing ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4">
            <form action={deleteOffering} onSubmit={(e) => { if (!confirm(t('teach.deleteConfirm'))) e.preventDefault() }}>
              <input type="hidden" name="offeringId" value={initial!.id} />
              <Button type="submit" variant="destructive" className="w-full">{t('teach.delete')}</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
