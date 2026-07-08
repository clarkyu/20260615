import Link from 'next/link'
import { ChevronRight, CheckCircle2, Circle, Lock } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { getT } from '@/lib/i18n-server'
import { representativeSubmission } from '@/lib/domain/submit'
import { isPhaseActiveFor } from '@/lib/domain/selection'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

type PhaseListData = Prisma.AssignmentGetPayload<{
  include: {
    offering: { include: { course: { select: { name: true } } } }
    phases: {
      include: {
        _count: { select: { sentences: true } }
        submissions: { select: { status: true; finalScore: true; recitedText: true } }
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

  // 甲·分流：读学生在「选题·分流」环节选的题目;据此把带门(归属题目)环节判为「本主题该做」还是「非你主题」。
  const selectionPhase = assignment.phases.find((p) => p.selectionMode === 'branch')
  const chosenTopic = selectionPhase ? (representativeSubmission(selectionPhase.submissions)?.recitedText?.trim() || null) : null

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
          // 甲·分流:非你所选主题的带门环节锁住(不可进);若已有历史提交则仍可进去看(软性只读,不锁)。
          const locked = !isPhaseActiveFor(p.branchTopicsJson, chosenTopic) && !done
          const statusText = locked
            ? (chosenTopic ? t('phase.otherTopic') : t('phase.lockedUntilChoice'))
            : notOpen ? t('sub.notOpen') : done ? t('phase.submitted') : closed ? t('sub.closed') : t('phase.todo')
          const inner = (
            <Card className={locked ? 'opacity-60' : 'tap hover:shadow-card'}>
              <CardContent className="flex items-center gap-3 p-3.5">
                <div className="shrink-0">
                  {done ? <CheckCircle2 className="h-6 w-6 text-success" /> : (locked || notOpen) ? <Lock className="h-6 w-6 text-muted-foreground" /> : <Circle className="h-6 w-6 text-muted-foreground" />}
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
                {locked ? null : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
              </CardContent>
            </Card>
          )
          return (
            <li key={p.id}>
              {locked ? inner : <Link href={`/student/assignments/${assignment.id}/phase/${p.id}`}>{inner}</Link>}
            </li>
          )
        })}
      </ol>

      <Link href="/student" className="block text-center text-sm text-muted-foreground hover:text-foreground">{t('back')}</Link>
    </div>
  )
}
