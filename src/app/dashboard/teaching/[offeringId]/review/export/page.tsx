import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import { ReviewExportClient } from './export-client'

// 学校平台成绩导出(老师):上传学校下发的成绩导入模板 → 预览核对(匹配/缺分名单)→
// 生成下载已填文件。行列与模板完全一致,只回填三列成绩。
export default async function ReviewExportPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) notFound()

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
        <h1 className="text-xl font-bold">{t('rexp.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {offering.course.name} · {offering.class.name} · {t('rexp.desc')}
        </p>
      </div>
      <ReviewExportClient offeringId={offering.id} />
    </div>
  )
}
