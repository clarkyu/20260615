import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import * as userRepo from '@/lib/repo/users'
import * as assignmentRepo from '@/lib/repo/assignments'
import { PhaseSubmit } from '../../phase-submit'

// One phase's submit screen (reached from the multi-phase checklist).
export default async function StudentPhasePage({ params }: { params: Promise<{ id: string; phaseId: string }> }) {
  const { id, phaseId } = await params
  const assignmentId = Number(id)
  const pid = Number(phaseId)
  if (!Number.isInteger(assignmentId) || !Number.isInteger(pid)) notFound()

  const user = await requireRole('STUDENT')
  const prisma = await getDb()
  const me = await userRepo.findById(prisma, user.userId)
  if (me?.mustChangePassword) redirect('/student/change-password')
  const classIds = await userRepo.studentClassIds(prisma, user.userId)
  if (classIds.length === 0) notFound()

  const [phase, overview] = await Promise.all([
    assignmentRepo.findPhaseDetailForStudent(prisma, pid, classIds, user.userId),
    assignmentRepo.findForStudentPhaseList(prisma, assignmentId, classIds, user.userId),
  ])
  if (!phase || phase.assignmentId !== assignmentId) notFound()

  const { t } = await getT()
  const heading = phase.title?.trim() || t('phase.nth', { n: phase.order })

  // 多环节自动衔接：交完本环节后，引导/自动进入「之后第一个还没做、且在开放期内」的环节。
  const DONE = ['UPLOADED', 'PROCESSING', 'GRADED', 'FLAGGED']
  const now = new Date()
  let nextHref: string | null = null
  let nextLabel: string | null = null
  if (overview) {
    const curIdx = overview.phases.findIndex((p) => p.id === pid)
    for (let i = curIdx + 1; i < overview.phases.length; i++) {
      const p = overview.phases[i]
      const done = p.submissions[0] ? DONE.includes(p.submissions[0].status) : false
      const notOpen = p.openAt ? now < p.openAt : false
      const closed = p.dueAt ? now > p.dueAt : false
      if (!done && !notOpen && !closed) {
        nextHref = `/student/assignments/${assignmentId}/phase/${p.id}`
        nextLabel = p.title?.trim() || t('phase.nth', { n: i + 1 })
        break
      }
    }
  }

  return (
    <div className="space-y-3">
      <Link href={`/student/assignments/${assignmentId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{t('phase.backToList')}
      </Link>
      <PhaseSubmit phase={phase} heading={heading} nextHref={nextHref} nextLabel={nextLabel} />
    </div>
  )
}
