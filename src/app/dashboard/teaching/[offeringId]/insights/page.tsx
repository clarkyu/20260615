import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, AlertTriangle, TrendingUp, RefreshCw, FileSpreadsheet } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { createReviewAssignment } from '@/actions/assignments'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  assignmentStats,
  studentProfiles,
  weakSentences,
  offeringSummary,
  parsePerSentence,
  type AnalyticsSubmission,
} from '@/lib/domain/analytics'

export default async function OfferingInsightsPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId: oid } = await params
  const offeringId = Number(oid)
  if (!Number.isInteger(offeringId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const offering = await prisma.courseOffering.findFirst({
    where: { id: offeringId, schoolId: user.schoolId },
    include: { course: true, class: { select: { id: true, name: true } } },
  })
  if (!offering) notFound()

  const [students, assignments, rawSubs, rawPractice] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId: user.schoolId, classId: offering.classId, role: 'STUDENT' },
      select: { id: true, name: true, studentNo: true },
      orderBy: { studentNo: 'asc' },
    }),
    prisma.assignment.findMany({
      where: { offeringId },
      select: { id: true, title: true, sentences: { select: { order: true, text: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.submission.findMany({
      where: { assignment: { offeringId } },
      select: { studentId: true, assignmentId: true, attempt: true, status: true, finalScore: true, needsReview: true, aiResult: true },
      orderBy: [{ studentId: 'asc' }, { assignmentId: 'asc' }, { attempt: 'desc' }],
    }),
    // Practice rounds (训练) → 平时成绩, separate from graded submissions (测试).
    prisma.practiceAttempt.findMany({
      where: { assignment: { offeringId }, aiScore: { not: null } },
      select: { studentId: true, assignmentId: true, aiScore: true },
    }),
  ])

  // Keep only the latest attempt per (student, assignment).
  const seen = new Set<string>()
  const submissions: AnalyticsSubmission[] = []
  for (const s of rawSubs) {
    const key = `${s.studentId}:${s.assignmentId}`
    if (seen.has(key)) continue
    seen.add(key)
    submissions.push({
      studentId: s.studentId,
      assignmentId: s.assignmentId,
      status: s.status,
      finalScore: s.finalScore,
      needsReview: s.needsReview,
      perSentence: parsePerSentence(s.aiResult),
    })
  }

  const practice = rawPractice.map((p) => ({ studentId: p.studentId, assignmentId: p.assignmentId, aiScore: p.aiScore }))
  const roster = students.map((s) => ({ id: s.id, name: s.name ?? '', studentNo: s.studentNo ?? '' }))
  const stats = assignmentStats(assignments, submissions, students.length)
  const profiles = studentProfiles(roster, assignments, submissions, practice)
  const summary = offeringSummary(stats, profiles, students.length)
  const weak = weakSentences(submissions)
  const titleById = new Map(assignments.map((a) => [a.id, a.title]))
  const sentenceText = new Map<string, string>()
  for (const a of assignments) for (const s of a.sentences) sentenceText.set(`${a.id}:${s.order}`, s.text)
  const sem = offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')

  const tiles = [
    { label: t('insights.students'), value: String(summary.students) },
    { label: t('insights.dailyScore'), value: summary.dailyAvg == null ? '—' : String(summary.dailyAvg) },
    { label: t('insights.examScore'), value: summary.avgScore == null ? '—' : String(summary.avgScore) },
    { label: t('insights.atRisk'), value: String(summary.atRisk) },
  ]

  return (
    <div className="space-y-4 py-2">
      <Link href={`/dashboard/teaching/${offering.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        {offering.course.name} · {offering.class.name} · {offering.year} {sem}
      </Link>

      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">{t('insights.title')}</h1>
      </div>

      {students.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('insights.noStudents')}</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((tile) => (
              <Card key={tile.label}>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-extrabold tracking-tight tabular-nums">{tile.value}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{tile.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('insights.gradeNote')}</p>

          {/* At-risk students */}
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />{t('insights.riskTitle')}
            </h2>
            {profiles.filter((p) => p.atRisk).length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-success">{t('insights.noRisk')}</CardContent></Card>
            ) : (
              profiles.filter((p) => p.atRisk).map((p) => (
                <Card key={p.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-3.5">
                    <div className="min-w-0">
                      <div className="font-medium">{p.name} <span className="text-muted-foreground">{p.studentNo}</span></div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {p.riskReasons.map((r) => <Badge key={r} tone="warning">{t(r)}</Badge>)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{t('insights.daily')} {p.dailyScore == null ? '—' : p.dailyScore}</div>
                      <div>{t('insights.exam')} {p.avgScore == null ? '—' : p.avgScore}</div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </section>

          {/* Weakest lines (needs AI perception data) */}
          {weak.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">{t('insights.weakTitle')}</h2>
                <form action={createReviewAssignment}>
                  <input type="hidden" name="offeringId" value={offering.id} />
                  <Button type="submit" size="sm"><RefreshCw className="h-3.5 w-3.5" />{t('insights.reassign')}</Button>
                </form>
              </div>
              <Card>
                <CardContent className="space-y-2.5 p-4">
                  {weak.map((w) => {
                    const text = sentenceText.get(`${w.assignmentId}:${w.order}`)
                    return (
                      <div key={`${w.assignmentId}:${w.order}`} className="text-sm">
                        <div className="flex items-center gap-3">
                          <span className="w-10 shrink-0 text-xs font-medium text-[hsl(var(--warning))] tabular-nums">{Math.round(w.avgAccuracy * 100)}%</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-[hsl(var(--warning))]" style={{ width: `${Math.round(w.avgAccuracy * 100)}%` }} />
                          </div>
                        </div>
                        <div className="mt-0.5 pl-[3.25rem] text-xs text-muted-foreground">
                          {text ? <span className="text-foreground">{text}</span> : `${titleById.get(w.assignmentId)} · ${t('insights.lineN', { n: w.order })}`}
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </section>
          ) : null}

          {/* Full-class gradebook */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{t('insights.gradebook')}</h2>
              <a href={`/dashboard/teaching/${offering.id}/gradebook`}>
                <Button variant="outline" size="sm"><FileSpreadsheet className="h-3.5 w-3.5" />{t('insights.exportGrades')}</Button>
              </a>
            </div>
            <Card>
              <CardContent className="divide-y divide-border/60 p-0">
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  <span className="min-w-0 flex-1">{t('insights.student')}</span>
                  <span className="w-12 shrink-0 text-center">{t('insights.daily')}</span>
                  <span className="w-12 shrink-0 text-center">{t('insights.exam')}</span>
                  <span className="w-12 shrink-0 text-center">{t('insights.completion')}</span>
                </div>
                {[...profiles].sort((a, b) => a.studentNo.localeCompare(b.studentNo)).map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1 truncate">
                      {p.name} <span className="text-xs text-muted-foreground">{p.studentNo}</span>
                    </div>
                    <span className="w-12 shrink-0 text-center tabular-nums">{p.dailyScore == null ? '—' : p.dailyScore}</span>
                    <span className="w-12 shrink-0 text-center tabular-nums">{p.avgScore == null ? '—' : p.avgScore}</span>
                    <span className="w-12 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{p.submitted}/{p.totalAssignments}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          {/* Per-assignment table */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{t('insights.byAssignment')}</h2>
            {stats.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{t('teach.noAssignments')}</CardContent></Card>
            ) : (
              stats.map((a) => (
                <Link key={a.id} href={`/dashboard/assignments/${a.id}`}>
                  <Card className="tap hover:shadow-card">
                    <CardContent className="flex items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {t('insights.submitted')} {a.submitted}/{a.total}
                          {a.needsReview > 0 ? ` · ${a.needsReview} ${t('grade.toReview')}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xl font-bold tabular-nums">{a.avgScore == null ? '—' : a.avgScore}</div>
                        <div className="text-[11px] text-muted-foreground">{t('insights.avg')}</div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </section>
        </>
      )}
    </div>
  )
}
