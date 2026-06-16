import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, Video, ListChecks } from 'lucide-react'
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
import { BankFilters } from './bank-filters'

export default async function BankPage({ searchParams }: { searchParams: Promise<{ cefr?: string; strand?: string; domain?: string }> }) {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const isSuperAdmin = user.role === 'SUPER_ADMIN'
  // A super-admin curates the global pool and may have no school of their own.
  if (!user.schoolId && !isSuperAdmin) redirect('/dashboard')

  const { cefr, strand, domain } = await searchParams
  const filtered = Boolean(cefr || strand || domain)
  const sets = await bankRepo.listVisible(prisma, user.schoolId, { cefr, strand, domain })

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
      </div>

      <BankFilters cefr={cefr} strand={strand} domain={domain} />

      {sets.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{filtered ? t('bank.noMatch') : t('bank.empty')}</CardContent></Card>
      ) : (
        sets.map((s) => (
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
        ))
      )}
    </div>
  )
}
