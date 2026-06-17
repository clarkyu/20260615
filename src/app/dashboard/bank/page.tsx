import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as bankRepo from '@/lib/repo/bank'
import { BankActions } from './bank-actions'
import { BankList } from './bank-list'

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

  return (
    <div className="space-y-4 py-2">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('back')}
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('bank.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('bank.pickHint')}</p>
        </div>
        <div className="shrink-0">
          <BankActions isSuperAdmin={isSuperAdmin} />
        </div>
      </div>

      <BankList
        sets={sets}
        filtered={filtered}
        cefr={cefr}
        strand={strand}
        domain={domain}
        series={series}
        seriesOptions={allSeries}
      />
    </div>
  )
}
