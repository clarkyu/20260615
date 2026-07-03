'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'

export interface OfferingItem {
  id: number
  courseName: string
  courseCode: string
  classId: number
  className: string
  year: string
  semester: string
  assignmentCount: number
}


export function TeachingList({ offerings }: { offerings: OfferingItem[] }) {
  const t = useT()
  const [classId, setClassId] = useState('')
  const [term, setTerm] = useState('')

  // Distinct classes and terms present in the offerings, for the filter dropdowns.
  const classes = useMemo(() => {
    const m = new Map<number, string>()
    for (const o of offerings) m.set(o.classId, o.className)
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [offerings])

  const terms = useMemo(() => {
    const m = new Map<string, { year: string; semester: string }>()
    for (const o of offerings) m.set(`${o.year}|${o.semester}`, { year: o.year, semester: o.semester })
    return [...m.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (b.year + b.semester).localeCompare(a.year + a.semester))
  }, [offerings])

  const filtered = offerings.filter(
    (o) => (!classId || String(o.classId) === classId) && (!term || `${o.year}|${o.semester}` === term),
  )

  const sem = (s: string) => (s === '2' ? t('teach.sem2') : t('teach.sem1'))

  return (
    <div className="space-y-3">
      {(classes.length > 1 || terms.length > 1) ? (
        <div className="grid grid-cols-2 gap-2">
          <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="h-10" aria-label={t('teach.class')}>
            <option value="">{t('filter.allClasses')}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select value={term} onChange={(e) => setTerm(e.target.value)} className="h-10" aria-label={t('teach.semester')}>
            <option value="">{t('filter.allTerms')}</option>
            {terms.map((tm) => (
              <option key={tm.key} value={tm.key}>{tm.year} {sem(tm.semester)}</option>
            ))}
          </Select>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('filter.none')}</p>
      ) : (
        filtered.map((o) => (
          <Link key={o.id} href={`/dashboard/teaching/${o.id}`}>
            <Card className="tap hover:shadow-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">
                    {o.courseName} <span className="text-xs font-normal text-muted-foreground">{o.courseCode}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.className} · {o.year} {sem(o.semester)} · {o.assignmentCount} {t('teach.assignments')}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))
      )}
    </div>
  )
}
