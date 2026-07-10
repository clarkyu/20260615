import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, FileDown, UploadCloud } from 'lucide-react'
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import * as reviewRepo from '@/lib/repo/review'
import * as classPerfRepo from '@/lib/repo/class-perf'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LocalDate } from '@/components/local-date'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('review.hubTitle') }
}

// 成绩档案(老师独立入口):所有课头的学期总评状态一览——雨课堂是否已导入、
// 发布到第几版,一键进各班工作台/导入页/学校平台导出页。只读聚合,读经 repo。
export default async function ReviewHubPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const [offerings, pubByOffering, impByOffering] = await Promise.all([
    offeringRepo.listForStaff(prisma, user.schoolId, user.userId, user.role),
    reviewRepo.latestLivePublishByOffering(prisma, user.schoolId, user.userId, user.role),
    classPerfRepo.latestImportByOffering(prisma, user.schoolId, user.userId, user.role),
  ])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('review.hubTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('review.hubDesc')}</p>
      </div>

      {offerings.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{t('review.hubEmpty')}</CardContent>
        </Card>
      )}

      {offerings.map((o) => {
        const pub = pubByOffering.get(o.id)
        const imp = impByOffering.get(o.id)
        return (
          <Card key={o.id}>
            <CardContent className="space-y-2.5 p-4">
              <Link href={`/dashboard/teaching/${o.id}/review`} className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {o.course.name} · {o.class.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {o.year} {o.semester === '2' ? t('teach.sem2') : t('teach.sem1')}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {imp ? (
                  <Badge tone="success">
                    {t('review.hubRain')} <LocalDate iso={imp.toISOString()} />
                  </Badge>
                ) : (
                  <Badge tone="warning">{t('review.hubRainNone')}</Badge>
                )}
                {pub ? (
                  <Badge tone="primary">
                    {t('review.hubPub')} v{pub.version} · <LocalDate iso={pub.publishedAt.toISOString()} />
                  </Badge>
                ) : (
                  <Badge tone="muted">{t('review.hubPubNone')}</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-xs font-medium">
                <Link href={`/dashboard/teaching/${o.id}/review/import`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <UploadCloud className="h-3.5 w-3.5" />
                  {t('review.importLink')}
                </Link>
                <Link href={`/dashboard/teaching/${o.id}/review/export`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <FileDown className="h-3.5 w-3.5" />
                  {t('rexp.link')}
                </Link>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
