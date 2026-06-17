import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, Video, ListChecks, Layers } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as bankRepo from '@/lib/repo/bank'
import { CEFR_LEVELS, STRANDS } from '@/lib/curriculum/taxonomy'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { CreateSetForm } from './create-set-form'
import { ImportStarter } from './import-starter'
import { ImportEnglishFlow } from './import-english-flow'
import { ImportPackForm } from './import-pack-form'
import { BankFilters } from './bank-filters'

type SetRow = {
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
function levelRange(sets: SetRow[]): string | null {
  const ords = sets.map((s) => CEFR_LEVELS.find((l) => l.band === s.cefr)?.ordinal).filter((o): o is number => o != null)
  if (ords.length === 0) return null
  const lo = CEFR_LEVELS.find((l) => l.ordinal === Math.min(...ords))!.label
  const hi = CEFR_LEVELS.find((l) => l.ordinal === Math.max(...ords))!.label
  return lo === hi ? lo : `${lo}–${hi}`
}

export default async function BankPage({ searchParams }: { searchParams: Promise<{ cefr?: string; strand?: string; domain?: string; series?: string }> }) {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const isSuperAdmin = user.role === 'SUPER_ADMIN'
  // A super-admin curates the global pool and may have no school of their own.
  if (!user.schoolId && !isSuperAdmin) redirect('/dashboard')

  const { cefr, strand, domain, series } = await searchParams
  const filtered = Boolean(cefr || strand || domain || series)
  const [sets, allSeries] = await Promise.all([
    bankRepo.listVisible(prisma, user.schoolId, { cefr, strand, domain, series }),
    bankRepo.seriesList(prisma, user.schoolId),
  ])

  // Group by series (sets arrive ordered by series asc, name asc). Ungrouped last.
  const groups = new Map<string, SetRow[]>()
  for (const s of sets) {
    const k = s.series ?? ''
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))

  const setCard = (s: SetRow) => (
    <Link key={s.id} href={`/dashboard/bank/${s.id}`}>
      <Card className="tap hover:shadow-card">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate font-semibold leading-snug">
              {s.schoolId === null ? <Badge tone="success">{t('bank.official')}</Badge> : null}
              {s.name}
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{s._count.chunks} {t('bank.chunkUnit')}</span>
              <span className={'inline-flex items-center gap-1 ' + (s.shadowVideoKey ? 'text-success' : '')}>
                <Video className="h-3.5 w-3.5" />{s.shadowVideoKey ? t('bank.hasVideo') : t('bank.noVideo')}
              </span>
            </p>
            {s.cefr || s.strand ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.cefr ? <Badge tone="primary">{CEFR_LEVELS.find((l) => l.band === s.cefr)?.label ?? s.cefr}</Badge> : null}
                {s.strand ? <Badge>{STRANDS.find((x) => x.id === s.strand)?.label ?? s.strand}</Badge> : null}
              </div>
            ) : null}
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  )

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('bank.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('bank.desc')}</p>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <CreateSetForm canPublishGlobal={isSuperAdmin} />
        <ImportStarter toGlobal={isSuperAdmin} />
        {isSuperAdmin ? <ImportEnglishFlow /> : null}
        {isSuperAdmin ? <ImportPackForm /> : null}
      </div>

      <BankFilters cefr={cefr} strand={strand} domain={domain} series={series} seriesOptions={allSeries} />

      {sets.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{filtered ? t('bank.noMatch') : t('bank.empty')}</CardContent></Card>
      ) : (
        ordered.map(([key, groupSets]) => {
          const range = levelRange(groupSets)
          return (
            <div key={key || 'ungrouped'} className="space-y-2">
              <h2 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold">
                <span className="inline-flex items-center gap-1.5"><Layers className="h-4 w-4 text-primary" />{key || t('bank.ungrouped')}</span>
                <span className="font-normal text-muted-foreground">· {groupSets.length} {t('bank.setUnit')}{range ? ` · ${range}` : ''}</span>
              </h2>
              {groupSets.map(setCard)}
            </div>
          )
        })
      )}
    </div>
  )
}
