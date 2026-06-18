import Link from 'next/link'
import { ClipboardList, ChevronRight, Inbox } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as assignmentRepo from '@/lib/repo/assignments'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// The staff "作业" menu: every assignment in the teacher's scope, newest first,
// each linking to its grading screen.
export default async function StaffAssignmentsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { t } = await getT()

  if (!user.schoolId) {
    return (
      <div className="py-2">
        <h1 className="mb-3 text-2xl font-bold tracking-tight">{t('nav.assignments')}</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-50" />{t('asgList.empty')}
          </CardContent>
        </Card>
      </div>
    )
  }

  const [list, pending] = await Promise.all([
    assignmentRepo.listForStaff(prisma, user.schoolId, user.userId, user.role),
    assignmentRepo.pendingReviewByAssignment(prisma, user.schoolId, user.userId, user.role),
  ])

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.assignments')}</h1>
        <span className="text-sm text-muted-foreground">{list.length}</span>
      </div>

      {list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-50" />{t('asgList.empty')}
          </CardContent>
        </Card>
      ) : (
        list.map((a) => {
          const pend = pending.get(a.id) ?? 0
          return (
            <Link key={a.id} href={`/dashboard/assignments/${a.id}`}>
              <Card className="tap hover:shadow-card">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    {a.category ? <Badge tone="primary" className="mb-1">{a.category}</Badge> : null}
                    <p className="truncate font-semibold leading-snug">{a.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {a.offering.course.name} · {a.offering.class.name}
                      {a._count.phases > 1 ? ` · ${a._count.phases} ${t('phase.unit')}` : ''}
                      {a.dueAt ? ` · ${t('asg.due')} ${a.dueAt.toISOString().slice(0, 10)}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('asgList.submittedN', { n: a._count.submissions })}</p>
                  </div>
                  {pend > 0 ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                      {t('dash.pendingN', { n: pend })}
                    </span>
                  ) : null}
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          )
        })
      )}
    </div>
  )
}
