import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import { loadReviewWorkbench } from '@/lib/domain/review-load'
import { ReviewWorkbench } from './review-client'

// 学期总评工作台(老师):行=学生,列=课堂表现/训练/期末/总评;比例可调即时重算,
// 逐格可改分/免计。草稿态读时现算;发布(快照/版本)在后续 PR。
export default async function ReviewPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) notFound()

  const data = await loadReviewWorkbench(prisma, { id: offering.id, classId: offering.classId }, {
    schoolId: user.schoolId,
    userId: user.userId,
    role: user.role,
  })

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/teaching/${offering.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {offering.course.name} · {offering.class.name}
      </Link>
      <div>
        <h1 className="text-xl font-bold">{t('review.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {offering.year} {offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')} · {t('review.cardDesc')}
        </p>
      </div>
      <ReviewWorkbench
        offeringId={offering.id}
        config={data.config}
        configVersion={data.configVersion}
        students={data.students}
        assignments={data.assignments}
        classPerf={data.classPerf ? { fileName: data.classPerf.fileName, sessions: data.classPerf.sessions } : null}
      />
    </div>
  )
}
