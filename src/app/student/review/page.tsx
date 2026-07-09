import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as reviewRepo from '@/lib/repo/review'
import { extractStudentView } from '@/lib/domain/review-publish'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LocalDate } from '@/components/local-date'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('review.stuTitle') }
}

// 学生「学期总评」:只读**已发布快照**(未撤回最大版)——学生所见=老师所发,与草稿无关。
// 隐私边界:extractStudentView 只回本人行 + 匿名班级聚合,其他学生的行不出 domain。
export default async function StudentReviewPage() {
  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.userId) redirect('/login')

  const publishes = await reviewRepo.listLivePublishesForStudent(prisma, user.userId)
  const views = publishes
    .map((p) => ({
      view: extractStudentView(p.snapshotJson, p.configJson, user.userId),
      meta: p,
    }))
    .filter((x): x is { view: NonNullable<ReturnType<typeof extractStudentView>>; meta: (typeof publishes)[number] } => x.view != null)

  const catRows = [
    { key: 'classroom' as const, label: t('review.classroom') },
    { key: 'training' as const, label: t('review.training') },
    { key: 'final' as const, label: t('review.final') },
  ]

  return (
    <div className="space-y-4">
      <Link href="/student" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        {t('nav.myWork')}
      </Link>
      <h1 className="text-xl font-bold">{t('review.stuTitle')}</h1>

      {views.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{t('review.stuNotPublished')}</CardContent>
        </Card>
      )}

      {views.map(({ view, meta }) => (
        <Card key={meta.offeringId}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="font-semibold">
                {meta.offering.course.name} · {meta.offering.class.name}
              </p>
              <span className="text-xs text-muted-foreground">
                {meta.offering.year} {meta.offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')} · v{meta.version} ·{' '}
                <LocalDate iso={meta.publishedAt.toISOString()} />
              </span>
            </div>

            <div className="flex items-end gap-3">
              <span className="text-4xl font-bold tabular-nums">{view.total == null ? '—' : view.total.toFixed(1)}</span>
              <span className="pb-1 text-sm text-muted-foreground">{t('review.total')}</span>
              {view.classAgg.total.mean != null && (
                <span className="pb-1 text-xs text-muted-foreground">
                  {t('review.stuClassMean')}: {view.classAgg.total.mean.toFixed(1)} · {t('review.stuClassMedian')}:{' '}
                  {view.classAgg.total.median?.toFixed(1) ?? '—'}
                </span>
              )}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-2">{t('review.stuCategory')}</th>
                  <th scope="col" className="py-1.5 pr-2">{t('review.stuWeight')}</th>
                  <th scope="col" className="py-1.5 pr-2">{t('review.stuMyScore')}</th>
                  <th scope="col" className="py-1.5">{t('review.stuClassMean')}</th>
                </tr>
              </thead>
              <tbody>
                {catRows.map(({ key, label }) => (
                  <tr key={key} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{label}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{view.weights ? `${view.weights[key]}%` : '—'}</td>
                    <td className="py-1.5 pr-2 tabular-nums">
                      {view.cat[key].exempt ? (
                        <Badge tone="muted">{t('review.exempted')}</Badge>
                      ) : view.cat[key].fin == null ? (
                        '—'
                      ) : (
                        view.cat[key].fin!.toFixed(1)
                      )}
                    </td>
                    <td className="py-1.5 tabular-nums text-muted-foreground">{view.classAgg[key].mean?.toFixed(1) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="text-xs text-muted-foreground">{t('review.stuDisclosure')}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
