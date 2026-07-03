import Link from 'next/link'
import { ChevronRight, CheckCircle2, Circle, Lock } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { getT } from '@/lib/i18n-server'
import { representativeSubmission } from '@/lib/domain/submit'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

type PhaseListData = Prisma.AssignmentGetPayload<{
  include: {
    offering: { include: { course: { select: { name: true } } } }
    phases: {
      include: {
        _count: { select: { sentences: true } }
        submissions: { select: { status: true; finalScore: true } }
      }
    }
  }
}>

const DONE = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']

// Multi-phase landing screen: the assignment's phases as an ordered checklist, each
// linking to its own submit screen. (Single-phase assignments skip this and render
// the flow directly.)
export async function PhaseList({ assignment }: { assignment: PhaseListData }) {
  const { t } = await getT()
  const now = new Date()

  return (
    <div className="space-y-4">
      <div>
        {assignment.category ? <Badge tone="primary" className="mb-1">{assignment.category}</Badge> : null}
        <h1 className="text-xl font-bold tracking-tight">{assignment.title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{assignment.offering.course.name}</p>
        {assignment.instructions ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{assignment.instructions}</p> : null}
      </div>

      <p className="text-sm text-muted-foreground">{t('phase.listHint')}</p>

      <ol className="space-y-2.5">
        {assignment.phases.map((p, i) => {
          const latest = representativeSubmission(p.submissions)
          const done = latest ? DONE.includes(latest.status) : false
          const notOpen = p.openAt ? now < p.openAt : false
          const closed = p.dueAt ? now > p.dueAt : false
          const label = p.title?.trim() || t('phase.nth', { n: i + 1 })
          const statusText = notOpen ? t('sub.notOpen') : done ? t('phase.submitted') : closed ? t('sub.closed') : t('phase.todo')
          return (
            <li key={p.id}>
              <Link href={`/student/assignments/${assignment.id}/phase/${p.id}`}>
                <Card className="tap hover:shadow-card">
                  <CardContent className="flex items-center gap-3 p-3.5">
                    <div className="shrink-0">
                      {done ? <CheckCircle2 className="h-6 w-6 text-success" /> : notOpen ? <Lock className="h-6 w-6 text-muted-foreground" /> : <Circle className="h-6 w-6 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{t('phase.nth', { n: i + 1 })}</span>
                        {p.category ? <Badge tone="primary">{p.category}</Badge> : null}
                        {!p.graded ? <Badge>{t('phase.practiceOnly')}</Badge> : null}
                      </div>
                      <div className="truncate font-medium">{label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p._count.sentences} {t('phase.sentenceUnit')} · {statusText}
                        {done && latest?.finalScore != null ? <span className="ml-1 font-semibold text-foreground">{latest.finalScore}{t('phase.scoreSuffix')}</span> : null}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            </li>
          )
        })}
      </ol>

      <Link href="/student" className="block text-center text-sm text-muted-foreground hover:text-foreground">{t('back')}</Link>
    </div>
  )
}
