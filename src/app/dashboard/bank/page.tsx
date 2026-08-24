import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import * as bankRepo from '@/lib/repo/bank'
import * as templateRepo from '@/lib/repo/templates'
import { parseTemplatePayload, summarizeTemplatePayload } from '@/lib/assignment-template'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BankActions } from './bank-actions'
import { BankList } from './bank-list'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('nav.bank') }
}

export default async function BankPage({ searchParams }: { searchParams: Promise<{ cefr?: string; strand?: string; domain?: string; series?: string; video?: string }> }) {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  const isSuperAdmin = user.role === 'SUPER_ADMIN'
  // A super-admin curates the global pool and may have no school of their own.
  if (!user.schoolId && !isSuperAdmin) redirect('/dashboard')

  const { cefr, strand, domain, series, video } = await searchParams
  const hasVideo = video === '1'
  const filtered = Boolean(cefr || strand || domain || series || hasVideo)
  const [sets, allSeries, recent, favorites, favoriteIds, templates] = await Promise.all([
    bankRepo.listVisible(prisma, user.schoolId, { cefr, strand, domain, series, hasVideo }),
    bankRepo.seriesList(prisma, user.schoolId),
    bankRepo.listRecentlyUsedByTeacher(prisma, user.schoolId, user.userId),
    bankRepo.listFavorites(prisma, user.schoolId, user.userId),
    bankRepo.favoriteSetIds(prisma, user.userId),
    templateRepo.listVisibleWithPayload(prisma, user.schoolId),
  ])
  // 笔试试卷(作业模板)是题库的基础组成之一(clark 2026-08-23 定):与句库并列展示,
  // 可从这里直达发布。payload 坏的行跳过(不因一份坏模板拖垮整页)。
  const papers = templates
    .map((tm) => {
      const payload = parseTemplatePayload(tm.payload)
      return payload ? { id: tm.id, name: tm.name, series: tm.series, official: tm.schoolId == null, creator: tm.createdBy?.name ?? null, sum: summarizeTemplatePayload(payload) } : null
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
  // 按系列分组(clark 定:试卷按系列组织,如「专升本英语」);无系列的归「未分组」殿后。
  const paperGroups: { series: string | null; rows: typeof papers }[] = []
  {
    const byKey = new Map<string, (typeof paperGroups)[number]>()
    for (const p of papers) {
      const k = p.series ?? ''
      let g = byKey.get(k)
      if (!g) {
        g = { series: p.series, rows: [] }
        byKey.set(k, g)
        paperGroups.push(g)
      }
      g.rows.push(p)
    }
    paperGroups.sort((a, b) => (a.series === null ? 1 : b.series === null ? -1 : a.series.localeCompare(b.series, 'zh-CN')))
  }

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

      {/* 笔试试卷(作业模板):题库的基础组成之一,与句库并列。点「发布」进作业表单(整卷预填)。 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            {t('bank.papersTitle')}
            <span className="text-sm font-normal text-muted-foreground">{papers.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {papers.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t('bank.papersEmpty')}</p>
          ) : (
            paperGroups.map((g) => (
              <div key={g.series ?? '__none__'} className="space-y-1">
                <p className="px-2 text-xs font-semibold text-muted-foreground">
                  {g.series ?? t('bank.paperNoSeries')}
                  <span className="ml-1 font-normal">{g.rows.length}</span>
                </p>
                {g.rows.map((p) => (
              <Link key={p.id} href={`/dashboard/teaching/new-assignment?template=${p.id}`} className="tap flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.name}
                    {p.official ? <Badge tone="primary" className="ml-1.5">{t('bank.official')}</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('bank.paperMeta', { phases: p.sum.phases, total: p.sum.totalWeight })}
                    {p.sum.objectivePhases > 0 ? ` · ${t('bank.paperObjective', { n: p.sum.objectivePhases })}` : ''}
                    {p.sum.aiJudgedPhases > 0 ? ` · ${t('bank.paperAiJudged', { n: p.sum.aiJudgedPhases })}` : ''}
                    {p.sum.mediaPhases > 0 ? ` · ${t('bank.paperMedia', { n: p.sum.mediaPhases })}` : ''}
                    {p.creator ? ` · ${p.creator}` : ''}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary">
                  {t('bank.paperPublish')}
                  <ChevronRight className="h-4 w-4" />
                </span>
              </Link>
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <BankList
        sets={sets}
        recent={recent}
        favorites={favorites}
        favoriteIds={favoriteIds}
        filtered={filtered}
        cefr={cefr}
        strand={strand}
        domain={domain}
        series={series}
        video={video}
        seriesOptions={allSeries}
      />
    </div>
  )
}
