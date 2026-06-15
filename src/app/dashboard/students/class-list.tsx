'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Search } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import { Input } from '@/components/ui/input'

export interface ClassItem {
  id: number
  name: string
  department: string | null
  major: string | null
  grade: string | null
  count: number
}

const SELECT = 'h-10 w-full rounded-xl border border-input bg-background px-2 text-sm'

// Distinct, sorted non-empty values of a field across the classes.
function distinctValues(classes: ClassItem[], pick: (c: ClassItem) => string | null) {
  return [...new Set(classes.map(pick).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b))
}

export function ClassList({ classes }: { classes: ClassItem[] }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [major, setMajor] = useState('')
  const [grade, setGrade] = useState('')

  const depts = useMemo(() => distinctValues(classes, (c) => c.department), [classes])
  const majors = useMemo(() => distinctValues(classes, (c) => c.major), [classes])
  // Newest cohort first.
  const grades = useMemo(() => distinctValues(classes, (c) => c.grade).reverse(), [classes])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return classes.filter(
      (c) =>
        (!dept || c.department === dept) &&
        (!major || c.major === major) &&
        (!grade || c.grade === grade) &&
        (!needle ||
          c.name.toLowerCase().includes(needle) ||
          (c.major ?? '').toLowerCase().includes(needle) ||
          (c.department ?? '').toLowerCase().includes(needle)),
    )
  }, [classes, q, dept, major, grade])

  const hasFilters = depts.length > 1 || majors.length > 1 || grades.length > 1

  return (
    <div className="space-y-2.5">
      {hasFilters ? (
        <div className="grid grid-cols-3 gap-2">
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={SELECT} aria-label={t('cls.dept')}>
            <option value="">{t('filter.allDepts')}</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={major} onChange={(e) => setMajor(e.target.value)} className={SELECT} aria-label={t('cls.major')}>
            <option value="">{t('filter.allMajors')}</option>
            {majors.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className={SELECT} aria-label={t('filter.grade')}>
            <option value="">{t('filter.allGrades')}</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      ) : null}

      {classes.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('filter.searchClass')} className="pl-9" />
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('filter.none')}</p>
      ) : (
        <div className="text-sm">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/students/${c.id}`}
              className="-mx-2 flex items-center justify-between gap-2 rounded-lg border-b border-border/60 px-2 py-2.5 last:border-0 hover:bg-secondary/60"
            >
              <span className="min-w-0">
                <span className="font-medium">{c.name}</span>
                {(c.grade || c.major || c.department) ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.grade ? `${c.grade}${t('cls.gradeSuffix')}` : null, c.major, c.department].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                {c.count} {t('stu.people')}
                <ChevronRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
