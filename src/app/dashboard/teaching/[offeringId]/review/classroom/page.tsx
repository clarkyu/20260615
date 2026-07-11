import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as offeringRepo from '@/lib/repo/offerings'
import { loadClassRainView } from '@/lib/domain/class-perf-view'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LocalDate } from '@/components/local-date'
import { RainDetailTable } from '@/components/rain-detail-table'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('rainview.title') }
}

// 课堂表现原始数据(老师):与评分同一数据版本/同一公式——逐生汇总 + 展开逐节明细,
// 学生质疑课堂分时的对证页。只读,读经 repo/domain。
export default async function ClassroomRawPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId, user.userId, user.role)
  if (!offering) notFound()

  const actor = { schoolId: user.schoolId, userId: user.userId, role: user.role }
  const view = await loadClassRainView(prisma, offeringId, actor)
  const counted = view?.sessions.filter((s) => s.counted).length ?? 0

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
        <h1 className="text-xl font-bold">{t('rainview.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {offering.course.name} · {offering.class.name}
          {view && (
            <>
              {' '}
              · {view.fileName} · {t('rain.sessionsCounted')} {counted} · <LocalDate iso={view.createdAt.toISOString()} />
            </>
          )}
        </p>
      </div>

      {!view && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {t('review.noClassPerf')}{' '}
            <Link href={`/dashboard/teaching/${offering.id}/review/import`} className="font-medium text-primary hover:underline">
              {t('review.importLink')}
            </Link>
          </CardContent>
        </Card>
      )}

      {view && (
        <>
          <p className="text-xs text-muted-foreground">
            {t('rainview.formulaNote', {
              a: view.weights.attendance,
              d: view.weights.danmaku,
              p: view.weights.posts,
              q: view.weights.answers,
            })}
          </p>

          <Card>
            <CardContent className="space-y-2 p-4">
              {view.students.map((s) => (
                <details key={s.studentNo} className="rounded-xl border border-border/60 px-3 py-2">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm marker:content-none">
                    {/* key 用原始学号(未匹配行含「!」隔离前缀,保证唯一);显示剥前缀 */}
                    <span className="font-medium tabular-nums">{s.studentNo.replace(/^!/, '')}</span>
                    <span>{s.name}</span>
                    {!s.matched && <Badge tone="warning">{t('rainview.unmatched')}</Badge>}
                    <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {t('rainview.attend')} {s.attended}/{s.countedSessions}
                      </span>
                      <span>
                        {t('rainview.danmaku')} {s.danmaku}
                      </span>
                      <span>
                        {t('rainview.posts')} {s.posts}
                      </span>
                      <span>
                        {t('rainview.answers')} {s.answeredSessions}/{s.questionSessions}
                      </span>
                      <span className="font-semibold tabular-nums text-foreground">{s.score == null ? '—' : s.score.toFixed(1)}</span>
                      {s.floored && <Badge tone="muted">{t('rainview.floored')}</Badge>}
                    </span>
                  </summary>
                  <div className="mt-2">
                    <RainDetailTable sessions={view.sessions} detail={s.detail} />
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{t('rainview.disclosure')}</p>
        </>
      )}
    </div>
  )
}
