import Link from 'next/link'
import { ClipboardList, ChevronRight, ChevronDown, Inbox } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import type { Metadata } from 'next'
import { getT } from '@/lib/i18n-server'
import * as assignmentRepo from '@/lib/repo/assignments'
import { groupAssignmentBatches } from '@/lib/assignment-batches'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LocalDate } from '@/components/local-date'

// The staff "作业" menu: assignments grouped by publish batch (one "发一份 + 勾多班" =
// one card), so N classes' copies of the same assignment no longer show as N rows.
// Each batch expands to its classes, each linking to that class's grading screen.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t('nav.assignments') }
}

// The submit-type label(s) of a phase, from its require* flags (same set the authoring
// form shows). t is param-less here (all these keys take no args).
interface PhaseSummary {
  requireVideo: boolean; requireAudio: boolean; requireText: boolean; requireHandwriting: boolean
  requireChoice: boolean; requireFreeText: boolean; fillBlank: boolean
}
function kindLabels(p: PhaseSummary, t: (key: string) => string): string {
  return [
    p.requireText && t('asg.kindText'),
    p.requireVideo && t('asg.kindVideo'),
    p.requireAudio && t('asg.kindAudio'),
    p.requireHandwriting && t('asg.kindHandwriting'),
    p.requireChoice && t('asg.kindChoice'),
    p.requireFreeText && t('asg.kindFreeText'),
    p.fillBlank && t('asg.kindFillBlank'),
  ].filter(Boolean).join(' / ')
}

export default async function StaffAssignmentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()

  const emptyState = (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
        <Inbox className="h-8 w-8 opacity-50" />{t('asgList.empty')}
      </CardContent>
    </Card>
  )

  if (!user.schoolId) {
    return (
      <div className="py-2">
        <h1 className="mb-3 text-2xl font-bold tracking-tight">{t('nav.assignments')}</h1>
        {emptyState}
      </div>
    )
  }

  const [list, pending, submitted] = await Promise.all([
    assignmentRepo.listForStaff(prisma, user.schoolId, user.userId, user.role),
    assignmentRepo.pendingReviewByAssignment(prisma, user.schoolId, user.userId, user.role),
    assignmentRepo.submittedCountByAssignment(prisma, user.schoolId, user.userId, user.role),
  ])

  const batches = groupAssignmentBatches(
    list.map((a) => ({
      id: a.id, title: a.title, category: a.category, dueAt: a.dueAt, batchId: a.batchId,
      phaseCount: a._count.phases, courseId: a.offering.courseId, courseName: a.offering.course.name, className: a.offering.class.name,
    })),
    submitted,
    pending,
  )

  // A batch's 内容/评分标准, from its representative (newest) assignment's phases — shown
  // inside the expanded card so the teacher sees 题型 + 标准 without drilling in.
  const repPhases = await assignmentRepo.listPhaseSummariesForAssignments(prisma, batches.map((b) => b.classes[0].assignmentId))
  const phasesByAssignment = new Map<number, typeof repPhases>()
  for (const p of repPhases) phasesByAssignment.set(p.assignmentId, [...(phasesByAssignment.get(p.assignmentId) ?? []), p])

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.assignments')}</h1>
        <span className="text-sm text-muted-foreground">{batches.length}</span>
      </div>

      {batches.length === 0 ? emptyState : batches.map((b) => {
        const meta = (
          <>
            {b.courseName}
            {b.classes.length > 1 ? ` · ${t('asgList.classesN', { n: b.classes.length })}` : ` · ${b.classes[0].className}`}
            {b.phaseCount > 1 ? ` · ${b.phaseCount} ${t('phase.unit')}` : ''}
            {b.dueAt ? <> · {t('asg.due')} <LocalDate iso={b.dueAt.toISOString()} /></> : null}
          </>
        )

        // Single class → a direct link card (no batch to expand).
        if (b.classes.length === 1) {
          const c = b.classes[0]
          return (
            <Link key={b.key} href={`/dashboard/assignments/${c.assignmentId}`}>
              <Card className="tap hover:shadow-card">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    {b.category ? <Badge tone="primary" className="mb-1">{b.category}</Badge> : null}
                    <p className="truncate font-semibold leading-snug">{b.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('asgList.submittedN', { n: c.submitted })}</p>
                  </div>
                  {c.pending > 0 ? <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{t('dash.pendingN', { n: c.pending })}</span> : null}
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          )
        }

        // Multi-class batch → expandable card; content (题型 + 评分标准) + each class links
        // to its own grading screen.
        const content = phasesByAssignment.get(b.classes[0].assignmentId) ?? []
        return (
          <details key={b.key} className="group rounded-2xl border border-border bg-card shadow-card">
            <summary className="tap flex cursor-pointer list-none items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                {b.category ? <Badge tone="primary" className="mb-1">{b.category}</Badge> : null}
                <p className="truncate font-semibold leading-snug">{b.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('asgList.submittedN', { n: b.totalSubmitted })}</p>
              </div>
              {b.totalPending > 0 ? <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{t('dash.pendingN', { n: b.totalPending })}</span> : null}
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            {content.length > 0 ? (
              <div className="space-y-1.5 border-t border-border/60 p-3">
                <div className="text-xs font-medium text-muted-foreground">{t('asgList.content')}</div>
                {content.map((p) => (
                  <div key={p.order} className="rounded-xl bg-secondary/50 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {content.length > 1 ? <span className="font-medium">{p.title?.trim() || t('phase.nth', { n: p.order })}</span> : null}
                      <span className="text-muted-foreground">{kindLabels(p, t)}</span>
                      {!p.graded ? <Badge>{t('phase.practiceOnly')}</Badge> : null}
                    </div>
                    {p.rubric?.trim() ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground"><span className="font-medium text-foreground">{t('grade.rubric')}</span>: {p.rubric}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="space-y-1 border-t border-border/60 p-2">
              {b.classes.map((c) => (
                <Link key={c.assignmentId} href={`/dashboard/assignments/${c.assignmentId}`} className="tap flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.className}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t('asgList.submittedN', { n: c.submitted })}</span>
                  {c.pending > 0 ? <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{t('dash.pendingN', { n: c.pending })}</span> : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}
