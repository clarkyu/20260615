import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, AlertTriangle, ChevronRight } from 'lucide-react'
import { requireStaff, getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import * as offeringRepo from '@/lib/repo/offerings'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import * as submissionRepo from '@/lib/repo/submissions'
import * as practiceRepo from '@/lib/repo/practice'
import { latestPhaseSubmissions, collapsePhases, studentAssignmentScores, studentWeakPoints } from '@/lib/domain/analytics'

const round1 = (n: number) => Math.round(n * 10) / 10
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

// Teacher's drill-down on ONE student in ONE offering: per-assignment scores
// (missing/待批/分数), 平时与测试均分、完成度, and their weakest lines.
// Tab title = the student's name (a teacher reviewing a class opens several of these).
// School-scoped exactly like the page's own student lookup.
export async function generateMetadata({ params }: { params: Promise<{ offeringId: string; studentId: string }> }): Promise<Metadata> {
  const { t } = await getT()
  const fallback = { title: t('nav.students') }
  const sid = Number((await params).studentId)
  if (!Number.isInteger(sid)) return fallback
  const user = await getCurrentUser()
  if (!user?.schoolId) return fallback
  const prisma = await getDb()
  const s = await userRepo.findStudentForSchool(prisma, sid, user.schoolId)
  return s ? { title: s.name || s.studentNo || t('nav.students') } : fallback
}

export default async function StudentDetailPage({ params }: { params: Promise<{ offeringId: string; studentId: string }> }) {
  const { offeringId: oid, studentId: sid } = await params
  const offeringId = Number(oid)
  const studentId = Number(sid)
  if (!Number.isInteger(offeringId) || !Number.isInteger(studentId)) notFound()

  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()
  if (!user.schoolId) redirect('/dashboard')

  const [offering, student] = await Promise.all([
    offeringRepo.findForSchoolWithCourseClass(prisma, offeringId, user.schoolId, user.userId, user.role),
    userRepo.findStudentForSchool(prisma, studentId, user.schoolId),
  ])
  if (!offering || !student) notFound()
  // The student must actually belong to this offering's class.
  const classIds = await userRepo.studentClassIds(prisma, studentId)
  if (!classIds.includes(offering.classId)) notFound()

  const [assignments, rawSubs, rawPractice] = await Promise.all([
    assignmentRepo.listForOfferingTitled(prisma, offeringId),
    submissionRepo.listForStudentInOfferingLatestFirst(prisma, offeringId, studentId),
    practiceRepo.listScoredForStudentInOffering(prisma, offeringId, studentId),
  ])

  const phaseRows = latestPhaseSubmissions(rawSubs)
  const submissions = collapsePhases(phaseRows)
  const practice = rawPractice.map((p) => ({ studentId, assignmentId: p.assignmentId, aiScore: p.aiScore }))
  const scores = studentAssignmentScores(submissions, assignments.map((a) => ({ id: a.id, title: a.title })), practice)
  const sentences = assignments.flatMap((a) => a.sentences.map((s) => ({ assignmentId: a.id, phaseId: s.phaseId, order: s.order, text: s.text })))
  const weak = studentWeakPoints(phaseRows, sentences)
  const titleById = new Map(assignments.map((a) => [a.id, a.title]))

  const examAvg = mean(scores.map((s) => s.finalScore).filter((v): v is number => v != null))
  const dailyAvg = mean(scores.map((s) => s.bestPractice).filter((v): v is number => v != null))
  const submittedCount = scores.filter((s) => s.submitted).length
  const sem = offering.semester === '2' ? t('teach.sem2') : t('teach.sem1')

  const tiles = [
    { label: t('insights.daily'), value: dailyAvg == null ? '—' : String(dailyAvg) },
    { label: t('insights.exam'), value: examAvg == null ? '—' : String(examAvg) },
    { label: t('insights.completion'), value: `${submittedCount}/${scores.length}` },
  ]

  return (
    <div className="space-y-4 py-2">
      <Link href={`/dashboard/teaching/${offeringId}/insights`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        {offering.course.name} · {offering.class.name} · {offering.year} {sem}
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{student.name || '—'}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{student.studentNo}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold tracking-tight tabular-nums">{tile.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{tile.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-assignment results */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('stud.perAssignment')}</h2>
        {scores.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{t('teach.noAssignments')}</CardContent></Card>
        ) : (
          scores.map((s) => (
            <Link key={s.assignmentId} href={`/dashboard/assignments/${s.assignmentId}`}>
              <Card className="tap hover:shadow-card">
                <CardContent className="flex items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t('insights.daily')} {s.bestPractice == null ? '—' : s.bestPractice}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!s.submitted ? (
                      <Badge tone="warning">{t('grade.notSubmitted')}</Badge>
                    ) : s.finalScore == null ? (
                      <Badge tone="muted">{t('grade.toReview')}</Badge>
                    ) : (
                      <span className="text-xl font-bold tabular-nums">{s.finalScore}</span>
                    )}
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </section>

      {/* Weakest lines for this student */}
      {weak.length > 0 ? (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />{t('insights.weakTitle')}
          </h2>
          <Card>
            <CardContent className="space-y-2.5 p-4">
              {weak.map((w) => {
                const pct = Math.round(w.avgAccuracy * 100)
                return (
                  <div key={`${w.assignmentId}:${w.phaseId ?? 0}:${w.order}`} className="text-sm">
                    <div className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-xs font-medium text-warning tabular-nums">{pct}%</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-warning" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="mt-0.5 pl-[3.25rem] text-xs text-muted-foreground">
                      <span className="text-foreground">{w.text}</span>
                      <span> · {titleById.get(w.assignmentId)}</span>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  )
}
