import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as reviewRepo from '@/lib/repo/review'
import * as submissionRepo from '@/lib/repo/submissions'
import { extractStudentView } from '@/lib/domain/review-publish'
import { loadStudentRainViews } from '@/lib/domain/class-perf-view'
import { buildStudentArchive, type StudentPhaseCell } from '@/lib/domain/archive-view'
import { latestPhaseSubmissions, collapsePhases } from '@/lib/domain/analytics'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LocalDate } from '@/components/local-date'
import { RainDetailTable } from '@/components/rain-detail-table'

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

  const [publishes, rains, archiveRows] = await Promise.all([
    reviewRepo.listLivePublishesForStudent(prisma, user.userId),
    loadStudentRainViews(prisma, user.userId),
    submissionRepo.listForStudentArchive(prisma, user.userId),
  ])
  // 任务总分与成绩单同一算术源(latestPhaseSubmissions → collapsePhases 加权)。
  const collapsed = collapsePhases(latestPhaseSubmissions(archiveRows))
  const totalByAssignment = new Map(collapsed.map((c) => [c.assignmentId, c.status === 'DRAFT' ? null : c.finalScore]))
  const archive = buildStudentArchive(archiveRows, totalByAssignment)
  const phaseCellText = (p: StudentPhaseCell) => {
    if (p.score != null) return p.score.toFixed(1)
    if (p.status === 'MISSING') return t('arch.missing')
    return t('arch.pending')
  }
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

      {/* 我的成绩档案:学期 → 任务(按时间) → 环节分 + 总分(与成绩单同一算术源)。 */}
      {archive.length > 0 && (
        <>
          <h2 className="pt-1 text-lg font-bold">{t('arch.stuTitle')}</h2>
          {archive.map((sem) => (
            <Card key={`${sem.year}-${sem.semester}`}>
              <CardContent className="space-y-2 p-4">
                <p className="text-sm font-semibold">
                  {sem.year} {sem.semester === '2' ? t('teach.sem2') : t('teach.sem1')}
                </p>
                {sem.tasks.map((task) => (
                  <details key={task.assignmentId} className="rounded-xl border border-border/60 px-3 py-2">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm marker:content-none">
                      <span className="font-medium">{task.title}</span>
                      {task.mode && <Badge tone="muted">{t(`mode.${task.mode}`)}</Badge>}
                      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        {task.dueAt && <LocalDate iso={task.dueAt.toISOString()} />}
                        <span className="font-semibold tabular-nums text-foreground">
                          {task.total == null ? '—' : task.total.toFixed(1)}
                        </span>
                      </span>
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {task.phases.map((p) => (
                        <span key={p.order} className="tabular-nums">
                          {t('arch.phase')}
                          {p.order}
                          {p.title ? `·${p.title}` : ''} {phaseCellText(p)}
                        </span>
                      ))}
                    </div>
                  </details>
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}

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

      {/* 我的课堂记录(雨课堂原始数据):本人逐节信号 + 由此算出的课堂分——与老师端同一
          数据版本/同一公式,发布与否都可见,学生可自行核对「课堂表现」怎么来的。 */}
      {rains.length > 0 && (
        <>
          <h2 className="pt-2 text-lg font-bold">{t('rainview.stuTitle')}</h2>
          {rains.map((rv) => (
            <Card key={rv.offering.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-semibold">
                    {rv.offering.course} · {rv.offering.klass}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {rv.offering.year} {rv.offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')} ·{' '}
                    <LocalDate iso={rv.createdAt.toISOString()} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span>
                    {t('rainview.attend')} {rv.row.attended}/{rv.row.countedSessions}
                  </span>
                  <span>
                    {t('rainview.danmaku')} {rv.row.danmaku}
                  </span>
                  <span>
                    {t('rainview.posts')} {rv.row.posts}
                  </span>
                  <span>
                    {t('rainview.answers')} {rv.row.answeredSessions}/{rv.row.questionSessions}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {t('rainview.score')} {rv.row.score == null ? '—' : rv.row.score.toFixed(1)}
                  </span>
                  {rv.row.floored && <Badge tone="muted">{t('rainview.floored')}</Badge>}
                </div>
                <RainDetailTable sessions={rv.sessions} detail={rv.row.detail} />
                <p className="text-xs text-muted-foreground">{t('rainview.disclosure')}</p>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
