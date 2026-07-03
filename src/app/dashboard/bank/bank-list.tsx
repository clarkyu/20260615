'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronDown, Video, ListChecks, Layers, Search, Clock, Star } from 'lucide-react'
import { CEFR_LEVELS, STRANDS } from '@/lib/curriculum/taxonomy'
import { toggleBankFavorite } from '@/actions/bank'
import { useT } from '@/components/i18n-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BankFilters } from './bank-filters'

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

function levelRange(sets: BankSet[]): string | null {
  const ords = sets.map((s) => CEFR_LEVELS.find((l) => l.band === s.cefr)?.ordinal).filter((o): o is number => o != null)
  if (ords.length === 0) return null
  const lo = CEFR_LEVELS.find((l) => l.ordinal === Math.min(...ords))!.label
  const hi = CEFR_LEVELS.find((l) => l.ordinal === Math.max(...ords))!.label
  return lo === hi ? lo : `${lo}–${hi}`
}

// One tappable set row (a Link) with a star toggle that doesn't navigate.
function SetRow({ s, favorited, onToggleFav, favBusy }: { s: BankSet; favorited: boolean; onToggleFav: (id: number) => void; favBusy: boolean }) {
  const t = useT()
  return (
    <div className="flex items-center active:bg-secondary/40">
      <Link href={`/dashboard/bank/${s.id}`} className="tap flex min-w-0 flex-1 items-center gap-3 py-3 pl-4">
        <span className={'h-9 w-1 shrink-0 rounded-full ' + (s.schoolId === null ? 'bg-success/70' : 'bg-border')} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-snug">{s.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{s._count.chunks} {t('bank.chunkUnit')}</span>
            <span className={'inline-flex items-center gap-1 ' + (s.shadowVideoKey ? 'text-success' : '')}>
              <Video className="h-3.5 w-3.5" />{s.shadowVideoKey ? t('bank.hasVideo') : t('bank.noVideo')}
            </span>
            {s.cefr ? <Badge tone="primary">{CEFR_LEVELS.find((l) => l.band === s.cefr)?.label ?? s.cefr}</Badge> : null}
            {s.strand ? <Badge>{STRANDS.find((x) => x.id === s.strand)?.label ?? s.strand}</Badge> : null}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onToggleFav(s.id)}
        disabled={favBusy}
        aria-pressed={favorited}
        aria-label={t('bank.favorite')}
        className="tap grid h-12 w-11 shrink-0 place-items-center text-muted-foreground"
      >
        <Star className={'h-4 w-4 ' + (favorited ? 'fill-warning text-warning' : '')} />
      </button>
      <Link href={`/dashboard/bank/${s.id}`} className="tap grid h-12 w-8 shrink-0 place-items-center"><ChevronRight className="h-5 w-5 text-muted-foreground" /></Link>
    </div>
  )
}

// Mobile-portrait-first browse: a prominent search, the (scrollable) filters, then
// series shown as a tidy list of collapsed sections — tap one to reveal its sets.
// Searching auto-expands everything so matches are always visible.
export function BankList({
  sets,
  recent = [],
  favorites = [],
  favoriteIds = [],
  filtered,
  cefr,
  strand,
  domain,
  series,
  video,
  seriesOptions,
}: {
  sets: BankSet[]
  recent?: BankSet[]
  favorites?: BankSet[]
  favoriteIds?: number[]
  filtered: boolean
  cefr?: string
  strand?: string
  domain?: string
  series?: string
  video?: string
  seriesOptions: string[]
}) {
  const t = useT()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [favBusy, startFav] = useTransition()
  const favSet = new Set(favoriteIds)
  const toggleFav = (id: number) => startFav(async () => { await toggleBankFavorite(id); router.refresh() })
  const row = (s: BankSet) => <SetRow key={s.id} s={s} favorited={favSet.has(s.id)} onToggleFav={toggleFav} favBusy={favBusy} />

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
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('bank.search')} aria-label={t('bank.search')} className="h-11 pl-9" />
      </div>

      <BankFilters cefr={cefr} strand={strand} domain={domain} series={series} video={video} seriesOptions={seriesOptions} />

      {favorites.length > 0 && !filtered && !query ? (
        <section className="overflow-hidden rounded-lg border border-warning/30 bg-warning/5">
          <div className="flex items-center gap-2.5 px-4 py-3 text-sm font-semibold">
            <Star className="h-4 w-4 fill-warning text-warning" />{t('bank.favorites')}
          </div>
          <div className="divide-y divide-border/50 border-t border-border/50">
            {favorites.map((s) => row(s))}
          </div>
        </section>
      ) : null}

      {recent.length > 0 && !filtered && !query ? (
        <section className="overflow-hidden rounded-lg border border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2.5 px-4 py-3 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" />{t('bank.recentlyUsed')}
          </div>
          <div className="divide-y divide-border/50 border-t border-border/50">
            {recent.map((s) => row(s))}
          </div>
        </section>
      ) : null}

      {shown.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{filtered || query ? t('bank.noMatch') : t('bank.empty')}</CardContent></Card>
      ) : (
        <div className="space-y-2.5">
          {ordered.map(([key, gs]) => {
            const open = expanded.has(key) || query.length > 0
            const range = levelRange(gs)
            return (
              <section key={key || 'ungrouped'} className="overflow-hidden rounded-lg border border-border/60 bg-card">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left active:bg-secondary/50"
                >
                  <Layers className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold leading-tight">{key || t('bank.ungrouped')}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{gs.length} {t('bank.setUnit')}{range ? ` · ${range}` : ''}</span>
                  </span>
                  {open ? <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
                </button>
                {open ? (
                  <div className="divide-y divide-border/50 border-t border-border/50">
                    {gs.map((s) => row(s))}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
