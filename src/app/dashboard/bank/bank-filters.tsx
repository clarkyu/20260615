'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { CEFR_LEVELS, STRANDS, DOMAINS } from '@/lib/curriculum/taxonomy'
import { useT } from '@/components/i18n-provider'

const SELECT = 'h-9 rounded-lg border border-input bg-background px-2.5 text-sm'
const speakingStrands = STRANDS.filter((s) => s.parent === 'english.speaking')

// URL-driven filters for the bank index. Each select writes its value into the
// query string (empty → removed), and the server component re-queries. Kept
// stateless so the URL is the single source of truth (shareable / back-button).
export function BankFilters({ cefr, strand, domain, series, seriesOptions = [] }: { cefr?: string; strand?: string; domain?: string; series?: string; seriesOptions?: string[] }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const active = Boolean(cefr || strand || domain || series)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('bank.filter')}</span>
      {seriesOptions.length > 0 ? (
        <select aria-label={t('bank.series')} value={series ?? ''} onChange={(e) => set('series', e.target.value)} className={SELECT}>
          <option value="">{t('bank.series')}</option>
          {seriesOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : null}
      <select aria-label={t('bank.level')} value={cefr ?? ''} onChange={(e) => set('cefr', e.target.value)} className={SELECT}>
        <option value="">{t('bank.level')}</option>
        {CEFR_LEVELS.map((l) => <option key={l.band} value={l.band}>{l.label}</option>)}
      </select>
      <select aria-label={t('bank.skill')} value={strand ?? ''} onChange={(e) => set('strand', e.target.value)} className={SELECT}>
        <option value="">{t('bank.skill')}</option>
        {speakingStrands.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select aria-label={t('bank.domain')} value={domain ?? ''} onChange={(e) => set('domain', e.target.value)} className={SELECT}>
        <option value="">{t('bank.domain')}</option>
        {DOMAINS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      {active ? (
        <button
          type="button"
          onClick={() => router.replace(pathname)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />{t('bank.filterClear')}
        </button>
      ) : null}
    </div>
  )
}
