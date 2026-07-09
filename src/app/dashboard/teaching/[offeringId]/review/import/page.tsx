import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import * as classPerfRepo from '@/lib/repo/class-perf'
import { LocalDate } from '@/components/local-date'
import { RainImportClient } from './import-client'
import type { RainSession } from '@/lib/rain-classroom'

// 雨课堂「课堂情况」导入(老师):上传 xlsx → 解析预览对账 → 确认落库。
// 每次导入生成新版本;学期总评默认用最新一版,配置可钉住旧版。
export default async function RainImportPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) notFound()

  const latest = await classPerfRepo.latestImport(prisma, offeringId, user.schoolId, user.userId, user.role)
  let latestSessions = 0
  if (latest) {
    try {
      latestSessions = (JSON.parse(latest.sessionsJson) as RainSession[]).filter((s) => s.counted).length
    } catch {
      /* 旧行损坏只影响展示计数 */
    }
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/teaching/${offering.id}/review`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t('rain.backToReview')}
      </Link>
      <div>
        <h1 className="text-xl font-bold">{t('rain.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {offering.course.name} · {offering.class.name} · {t('rain.desc')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {latest ? (
            <>
              {t('rain.current', { file: latest.fileName, n: latestSessions })} <LocalDate iso={latest.createdAt.toISOString()} />
            </>
          ) : (
            t('rain.none')
          )}
        </p>
      </div>
      <RainImportClient offeringId={offering.id} />
    </div>
  )
}
