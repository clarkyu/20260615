'use client'

import { useActionState, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { createOffering, updateOffering, deleteOffering } from '@/actions/offerings'
import { sortByClassName } from '@/lib/class-sort'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useConfirm, confirmSubmit } from '@/components/ui/confirm'
import { SubmitButton } from '@/components/submit-button'
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


function currentAcademicYear(): string {
  const now = new Date()
  const y = now.getFullYear()
  return now.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`
}

export function OfferingForm({ classes, initial }: { classes: { id: number; name: string }[]; initial?: OfferingInitial }) {
  const t = useT()
  const confirm = useConfirm()
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
            {editing ? (
              <div className="space-y-1.5">
                <Label htmlFor="cls">{t('teach.class')}</Label>
                <Select id="cls" name="classId" defaultValue={initial?.classId ?? ''} required>
                  <option value="" disabled>—</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
            ) : (
              <MultiClassPicker classes={classes} t={t} />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="yr">{t('teach.year')}</Label>
                <Input id="yr" name="year" required defaultValue={initial?.year ?? currentAcademicYear()} placeholder="2025-2026" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sem">{t('teach.semester')}</Label>
                <Select id="sem" name="semester" defaultValue={initial?.semester ?? '1'}>
                  <option value="1">{t('teach.sem1')}</option>
                  <option value="2">{t('teach.sem2')}</option>
                </Select>
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
            <form action={deleteOffering} onSubmit={confirmSubmit(confirm, { body: t('teach.deleteConfirm'), danger: true })}>
              <input type="hidden" name="offeringId" value={initial!.id} />
              <SubmitButton variant="destructive" className="w-full">{t('teach.delete')}</SubmitButton>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// Multi-select class picker with a search box. Selection is kept in state and
// mirrored to hidden inputs, so filtering the visible list never drops a pick.
function MultiClassPicker({ classes, t }: { classes: { id: number; name: string }[]; t: (k: string, v?: Record<string, string | number>) => string }) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hit = needle ? classes.filter((c) => c.name.toLowerCase().includes(needle)) : classes
    return sortByClassName(hit, (c) => c.name) // 班级序号升序(全站口径;repo 是字符串序,这里升级 numeric)
  }, [classes, q])

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t('teach.classes')}</Label>
        {selected.size > 0 ? (
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
            {t('filter.selected', { n: selected.size })} · {t('filter.clear')}
          </button>
        ) : null}
      </div>

      {classes.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('filter.searchClass')} aria-label={t('filter.searchClass')} className="pl-9" />
        </div>
      ) : null}

      {/* Hidden inputs carry every selected class, even those filtered out of view. */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="classId" value={id} />
      ))}

      {/* 一班一行(全站口径,原 grid-cols-2 两班挤一行)。 */}
      <div className="grid max-h-60 grid-cols-1 gap-2 overflow-y-auto">
        {filtered.map((c) => {
          const on = selected.has(c.id)
          return (
            <button
              type="button"
              key={c.id}
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              className={
                'tap flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm ' +
                (on ? 'border-primary bg-accent text-accent-foreground' : 'border-input bg-background')
              }
            >
              <span className={'grid h-4 w-4 shrink-0 place-items-center rounded border ' + (on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                {on ? '✓' : ''}
              </span>
              <span className="truncate">{c.name}</span>
            </button>
          )
        })}
      </div>
      {filtered.length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">{t('filter.none')}</p> : null}
    </div>
  )
}
