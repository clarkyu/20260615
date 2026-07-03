'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import { LocalDate } from '@/components/local-date'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export interface AssignmentItem {
  id: number
  title: string
  category: string | null
  monthLabel: string | null
  dueAtIso: string | null
  sentenceCount: number
  submissionCount: number
}


// 老师在某授课下发布的作业列表 + 筛选器：按标题搜索、按作业类型、按月份。
// 与 TeachingList 一致：筛选项只在「有得可筛」时才出现，作业不多时不打扰。
export function AssignmentList({ assignments }: { assignments: AssignmentItem[] }) {
  const t = useT()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [month, setMonth] = useState('')

  const categories = useMemo(
    () => [...new Set(assignments.map((a) => a.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b)),
    [assignments],
  )
  const months = useMemo(
    () => [...new Set(assignments.map((a) => a.monthLabel).filter((m): m is string => Boolean(m)))].sort((a, b) => a.localeCompare(b)),
    [assignments],
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return assignments.filter(
      (a) =>
        (!needle || a.title.toLowerCase().includes(needle)) &&
        (!category || a.category === category) &&
        (!month || a.monthLabel === month),
    )
  }, [assignments, search, category, month])

  const showFilters = assignments.length > 3 || categories.length > 1 || months.length > 1

  return (
    <div className="space-y-3">
      {showFilters ? (
        <div className="space-y-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('filter.searchAssignment')} aria-label={t('filter.searchAssignment')} className="h-10" />
          {categories.length > 1 || months.length > 1 ? (
            <div className="flex gap-2">
              {categories.length > 1 ? (
                <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 flex-1" aria-label={t('filter.allCategories')}>
                  <option value="">{t('filter.allCategories')}</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              ) : null}
              {months.length > 1 ? (
                <Select value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 flex-1" aria-label={t('filter.allMonths')}>
                  <option value="">{t('filter.allMonths')}</option>
                  {months.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('filter.none')}</p>
      ) : (
        filtered.map((a) => (
          <Link key={a.id} href={`/dashboard/assignments/${a.id}`}>
            <Card className="tap hover:shadow-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  {a.category ? <Badge tone="primary" className="mb-1">{a.category}</Badge> : null}
                  <p className="font-semibold leading-snug">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.sentenceCount} {t('asg.sentences')} · {a.submissionCount} {t('asg.submissions')}
                    {a.dueAtIso ? <> · {t('asg.due')} <LocalDate iso={a.dueAtIso} /></> : null}
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
