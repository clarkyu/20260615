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

        // Multi-class batch → expandable card; each class links to its own grading screen.
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
