'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ChevronDown, Video, ListChecks, Layers, Search } from 'lucide-react'
import { CEFR_LEVELS, STRANDS } from '@/lib/curriculum/taxonomy'
import { useT } from '@/components/i18n-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export type BankSet = {
  id: number
  schoolId: number | null
  name: string
  shadowVideoKey: string | null
  cefr: string | null
  strand: string | null
  series: string | null
  _count: { chunks: number }
}

// Min–max CEFR label across a series' sets (skips sets with no level).
function levelRange(sets: BankSet[]): string | null {
  const ords = sets.map((s) => CEFR_LEVELS.find((l) => l.band === s.cefr)?.ordinal).filter((o): o is number => o != null)
  if (ords.length === 0) return null
  const lo = CEFR_LEVELS.find((l) => l.ordinal === Math.min(...ords))!.label
  const hi = CEFR_LEVELS.find((l) => l.ordinal === Math.max(...ords))!.label
  return lo === hi ? lo : `${lo}–${hi}`
}

// Client-side search (by name) over the server-filtered sets, then grouped into
// collapsible series sections. Search keeps the URL filters server-side.
export function BankList({ sets, filtered }: { sets: BankSet[]; filtered: boolean }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const query = q.trim().toLowerCase()
  const shown = query ? sets.filter((s) => s.name.toLowerCase().includes(query)) : sets

  const groups = new Map<string, BankSet[]>()
  for (const s of shown) {
    const k = s.series ?? ''
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))

  function toggle(k: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('bank.search')} className="pl-9" />
      </div>

      {shown.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{filtered || query ? t('bank.noMatch') : t('bank.empty')}</CardContent></Card>
      ) : (
        ordered.map(([key, gs]) => {
          const isCollapsed = collapsed.has(key)
          const range = levelRange(gs)
          return (
            <section key={key || 'ungrouped'} className="overflow-hidden rounded-2xl border border-border/60">
              <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center gap-2 bg-secondary/40 px-4 py-2.5 text-left hover:bg-secondary/70"
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <Layers className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-semibold">{key || t('bank.ungrouped')}</span>
                <span className="text-xs text-muted-foreground">· {gs.length} {t('bank.setUnit')}{range ? ` · ${range}` : ''}</span>
              </button>
              {!isCollapsed ? (
                <div className="divide-y divide-border/50">
                  {gs.map((s) => (
                    <Link key={s.id} href={`/dashboard/bank/${s.id}`} className="tap flex items-center gap-3 p-3.5 hover:bg-secondary/30">
                      {s.schoolId === null ? <span className="h-8 w-1 shrink-0 rounded-full bg-success/70" /> : <span className="h-8 w-1 shrink-0 rounded-full bg-border" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-snug">{s.name}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{s._count.chunks} {t('bank.chunkUnit')}</span>
                          <span className={'inline-flex items-center gap-1 ' + (s.shadowVideoKey ? 'text-success' : '')}>
                            <Video className="h-3.5 w-3.5" />{s.shadowVideoKey ? t('bank.hasVideo') : t('bank.noVideo')}
                          </span>
                          {s.cefr ? <Badge tone="primary">{CEFR_LEVELS.find((l) => l.band === s.cefr)?.label ?? s.cefr}</Badge> : null}
                          {s.strand ? <Badge>{STRANDS.find((x) => x.id === s.strand)?.label ?? s.strand}</Badge> : null}
                          {s.schoolId === null ? <Badge tone="success">{t('bank.official')}</Badge> : null}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              ) : null}
            </section>
          )
        })
      )}
    </div>
  )
}
