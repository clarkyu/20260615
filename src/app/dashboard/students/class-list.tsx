'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Search } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import { Input } from '@/components/ui/input'

export interface ClassItem {
  id: number
  name: string
  major: string | null
  count: number
}

export function ClassList({ classes }: { classes: ClassItem[] }) {
  const t = useT()
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return classes
    return classes.filter(
      (c) => c.name.toLowerCase().includes(needle) || (c.major ?? '').toLowerCase().includes(needle),
    )
  }, [classes, q])

  return (
    <div className="space-y-2">
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
              <span className="font-medium">{c.name}{c.major ? ` · ${c.major}` : ''}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
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
